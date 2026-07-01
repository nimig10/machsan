-- Smoke suite that LOCKS the peak-concurrent availability contract by calling the
-- REAL create_reservation_v2 (not a copy of its math). Guards against a future
-- accidental revert of 20260701120000 (SUM instead of MAX-overlap).
--
-- Setup: one equipment with 2 healthy units + two APPROVED 1-unit blockers in
-- DISJOINT windows (different students → the per-student guard never trips; loan
-- type 'סאונד' is in-campus → the external-loan guard is skipped).
--
--   P1  request spanning both blockers, qty 1 → ALLOWED  (peak=1, avail=2-1=1)
--       (pre-fix this raised "not enough units": SUM=2 → avail=0)
--   P2  same spanning window,          qty 2 → BLOCKED  (peak=1, avail=1 < 2)
--   (then add a THIRD blocker overlapping the first)
--   P3  window covering that overlap,  qty 1 → BLOCKED  (peak=2, avail=0)
--
-- Mirrors the run_student_overlap_tests harness (ephemeral __test_peak__ rows,
-- BEGIN/PERFORM/EXCEPTION on the 'not enough units' token, cleanup on entry+exit).

CREATE OR REPLACE FUNCTION public.run_availability_peak_tests(p_strict BOOLEAN DEFAULT TRUE)
RETURNS TABLE(scenario TEXT, expected TEXT, actual TEXT, passed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eq     TEXT := '__test_peak__eq';
  v_failed INT  := 0;
  v_first  TEXT := NULL;
BEGIN
  -- clean any leftovers
  DELETE FROM public.reservation_items WHERE reservation_id LIKE '__test_peak__%';
  DELETE FROM public.reservations_new  WHERE id              LIKE '__test_peak__%';
  DELETE FROM public.equipment_units   WHERE id              LIKE '__test_peak__%';
  DELETE FROM public.equipment         WHERE id              LIKE '__test_peak__%';

  -- Equipment with exactly 2 healthy units.
  INSERT INTO public.equipment (id, name, available_units) VALUES (v_eq, '__test_peak__ ציוד', 2);
  INSERT INTO public.equipment_units (id, equipment_id, status) VALUES
    ('__test_peak__u1', v_eq, 'תקין'),
    ('__test_peak__u2', v_eq, 'תקין');

  -- Two APPROVED 1-unit blockers in DISJOINT windows (different students).
  INSERT INTO public.reservations_new (id, email, status, loan_type, borrow_date, borrow_time, return_date, return_time)
    VALUES ('__test_peak__blkA', 'peaka@test.local', 'מאושר', 'סאונד', '2027-03-01','10:00','2027-03-01','12:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES ('__test_peak__blkA', v_eq, 'x', 1);
  INSERT INTO public.reservations_new (id, email, status, loan_type, borrow_date, borrow_time, return_date, return_time)
    VALUES ('__test_peak__blkB', 'peakb@test.local', 'מאושר', 'סאונד', '2027-03-05','10:00','2027-03-05','12:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES ('__test_peak__blkB', v_eq, 'x', 1);

  -- P1: window spans both disjoint blockers, qty 1 → ALLOWED (peak concurrent = 1).
  scenario := 'P1: window spans two disjoint 1-unit loans, qty 1 → allowed';
  expected := 'allowed';
  BEGIN
    PERFORM public.create_reservation_v2(
      jsonb_build_object('id','__test_peak__p1','email','peakz1@test.local','loan_type','סאונד',
        'borrow_date','2027-03-01','borrow_time','09:00','return_date','2027-03-05','return_time','13:00'),
      jsonb_build_array(jsonb_build_object('equipment_id',v_eq,'name','x','quantity',1)));
    actual := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM LIKE '%not enough units%' THEN 'blocked' ELSE 'error:'||SQLERRM END;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed+1; v_first := COALESCE(v_first, scenario||' got '||actual); END IF;
  RETURN NEXT;

  -- P2: same spanning window, qty 2 → BLOCKED (peak=1, avail = 2-1 = 1 < 2).
  scenario := 'P2: same spanning window, qty 2 → blocked (avail=1)';
  expected := 'blocked';
  BEGIN
    PERFORM public.create_reservation_v2(
      jsonb_build_object('id','__test_peak__p2','email','peakz2@test.local','loan_type','סאונד',
        'borrow_date','2027-03-01','borrow_time','09:00','return_date','2027-03-05','return_time','13:00'),
      jsonb_build_array(jsonb_build_object('equipment_id',v_eq,'name','x','quantity',2)));
    actual := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM LIKE '%not enough units%' THEN 'blocked' ELSE 'error:'||SQLERRM END;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed+1; v_first := COALESCE(v_first, scenario||' got '||actual); END IF;
  RETURN NEXT;

  -- Add a THIRD blocker that OVERLAPS blkA (both on 2027-03-01) → real concurrency.
  INSERT INTO public.reservations_new (id, email, status, loan_type, borrow_date, borrow_time, return_date, return_time)
    VALUES ('__test_peak__blkC', 'peakc@test.local', 'מאושר', 'סאונד', '2027-03-01','11:00','2027-03-01','13:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES ('__test_peak__blkC', v_eq, 'x', 1);

  -- P3: window covering the blkA/blkC overlap, qty 1 → BLOCKED (peak=2, avail=0).
  scenario := 'P3: two genuinely overlapping loans, qty 1 → blocked (peak=2)';
  expected := 'blocked';
  BEGIN
    PERFORM public.create_reservation_v2(
      jsonb_build_object('id','__test_peak__p3','email','peakz3@test.local','loan_type','סאונד',
        'borrow_date','2027-03-01','borrow_time','09:00','return_date','2027-03-01','return_time','14:00'),
      jsonb_build_array(jsonb_build_object('equipment_id',v_eq,'name','x','quantity',1)));
    actual := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM LIKE '%not enough units%' THEN 'blocked' ELSE 'error:'||SQLERRM END;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed+1; v_first := COALESCE(v_first, scenario||' got '||actual); END IF;
  RETURN NEXT;

  -- cleanup (also removes rows inserted by the "allowed" scenarios)
  DELETE FROM public.reservation_items WHERE reservation_id LIKE '__test_peak__%';
  DELETE FROM public.reservations_new  WHERE id              LIKE '__test_peak__%';
  DELETE FROM public.equipment_units   WHERE id              LIKE '__test_peak__%';
  DELETE FROM public.equipment         WHERE id              LIKE '__test_peak__%';

  IF v_failed > 0 AND p_strict THEN
    RAISE EXCEPTION 'run_availability_peak_tests: % scenario(s) FAILED. First: %', v_failed, v_first;
  END IF;
  RETURN;
END;
$function$;
