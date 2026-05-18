-- Productions board (לוח הפקות) — Session 11/N: smoke tests.
-- Self-contained function that seeds deterministic test data
-- (__test_productions__*) exercising:
--   1. Crew conflict detection (same student, overlapping productions).
--   2. Same student, non-overlapping times — both approvals allowed.
--   3. Cert recheck: uncertified crew on a 'מאושר' reservation flips to 'ממתין'.
--   4a. Cascade-delete on productions removes production_dates rows.
--   4b. Cascade-delete on productions sets reservations_new.production_id=NULL.
--   5. create_reservation_v2 still works with NO production_id (regression).
--
-- Note: production_delete_v1 itself is NOT exercised here because it requires
-- an auth.jwt() email context (director identity match) that the MCP/superuser
-- runner cannot satisfy. Its CASCADE behaviour (4a/4b) is verified via the
-- underlying FK actions, and the RPC itself is covered by the frontend
-- smoke tests in the PR description.
--
-- Cleanup is idempotent on entry and exit. Run:
--   SELECT * FROM public.run_productions_regression_tests();

CREATE OR REPLACE FUNCTION public.run_productions_regression_tests()
RETURNS TABLE(scenario text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stu_dir   text := '__test_productions__stu_director';
  v_stu_a     text := '__test_productions__stu_photog_A';
  v_stu_b     text := '__test_productions__stu_photog_B';
  v_eq_cert   text := '__test_productions__eq_cert';
  v_eq_noc    text := '__test_productions__eq_noc';
  v_cert      text := '__test_productions__cert_type';
  v_unit_c    text := '__test_productions__unit_cert';
  v_unit_n    text := '__test_productions__unit_noc';
  v_prod_a    text := '__test_productions__prod_A';
  v_prod_b    text := '__test_productions__prod_B';
  v_date_a    text := '__test_productions__date_A';
  v_date_b    text := '__test_productions__date_B';
  v_date_b2   text := '__test_productions__date_B2';
  v_crew_a    text := '__test_productions__crew_A';
  v_res_ok    text := '__test_productions__res_ok';
  v_res_flip  text := '__test_productions__res_flip';
  v_status    text;
  v_count     int;
  v_track_id  uuid;
BEGIN
  DELETE FROM public.reservation_items     WHERE reservation_id LIKE '__test_productions__%';
  DELETE FROM public.reservations_new      WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.production_crew       WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.production_dates      WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.productions           WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.student_certifications WHERE student_id     LIKE '__test_productions__%';
  DELETE FROM public.students              WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.certification_types   WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.equipment_units       WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.equipment             WHERE id              LIKE '__test_productions__%';

  SELECT id INTO v_track_id FROM public.tracks ORDER BY created_at LIMIT 1;

  INSERT INTO public.students (id, name, email, track_id) VALUES
    (v_stu_dir, '__test_productions__director', 'tp_director@test.local', v_track_id),
    (v_stu_a,   '__test_productions__photog A', 'tp_photog_a@test.local', v_track_id),
    (v_stu_b,   '__test_productions__photog B', 'tp_photog_b@test.local', v_track_id);

  INSERT INTO public.certification_types (id, name, category) VALUES
    (v_cert, '__test_productions__cert', 'cinema');

  INSERT INTO public.student_certifications (student_id, cert_type_id, status) VALUES
    (v_stu_a, v_cert, 'עבר');

  INSERT INTO public.equipment (id, name, total_quantity, available_units, certification_id) VALUES
    (v_eq_cert, '__test_productions__eq with cert', 1, 1, v_cert),
    (v_eq_noc,  '__test_productions__eq no cert',   1, 1, NULL);

  INSERT INTO public.equipment_units (id, equipment_id, status) VALUES
    (v_unit_c, v_eq_cert, 'תקין'),
    (v_unit_n, v_eq_noc,  'תקין');

  INSERT INTO public.productions (id, title, director_student_id, director_email, director_name, status)
    VALUES (v_prod_a, 'TP-A', v_stu_dir, 'tp_director@test.local', 'TP Director', 'published');
  INSERT INTO public.production_dates (id, production_id, start_date, start_time, end_date, end_time)
    VALUES (v_date_a, v_prod_a, '2027-04-01', '09:00', '2027-04-01', '12:00');

  INSERT INTO public.production_crew
    (id, production_id, role, student_id, status, invited_by, crew_email)
    VALUES (v_crew_a, v_prod_a, 'photographer', v_stu_a, 'approved', 'director', 'tp_photog_a@test.local');

  INSERT INTO public.productions (id, title, director_student_id, director_email, director_name, status)
    VALUES (v_prod_b, 'TP-B', v_stu_dir, 'tp_director@test.local', 'TP Director', 'published');
  INSERT INTO public.production_dates (id, production_id, start_date, start_time, end_date, end_time) VALUES
    (v_date_b,  v_prod_b, '2027-04-01', '10:00', '2027-04-01', '14:00'),
    (v_date_b2, v_prod_b, '2027-04-02', '09:00', '2027-04-02', '12:00');

  scenario := '1. conflict check raises on overlapping crew';
  expected := 'ok=false';
  DECLARE v jsonb;
  BEGIN
    v := public.production_check_crew_conflict_v1(v_stu_a, v_prod_b);
    actual := 'ok=' || (v->>'ok') || ' n=' || jsonb_array_length(v->'conflicts');
    passed := (v->>'ok')::boolean = FALSE;
  END;
  RETURN NEXT;

  DELETE FROM public.production_dates WHERE id = v_date_b;
  scenario := '2. no conflict when dates do not overlap';
  expected := 'ok=true';
  DECLARE v jsonb;
  BEGIN
    v := public.production_check_crew_conflict_v1(v_stu_a, v_prod_b);
    actual := 'ok=' || (v->>'ok');
    passed := (v->>'ok')::boolean = TRUE;
  END;
  RETURN NEXT;

  INSERT INTO public.production_dates (id, production_id, start_date, start_time, end_date, end_time)
    VALUES (v_date_b, v_prod_b, '2027-04-01', '10:00', '2027-04-01', '14:00');

  INSERT INTO public.reservations_new
    (id, status, loan_type, borrow_date, borrow_time, return_date, return_time,
     production_id, production_date_id, student_name, email)
    VALUES (v_res_flip, 'מאושר', 'הפקה', '2027-04-01', '09:00', '2027-04-01', '12:00',
            v_prod_a, v_date_a, 'TP Director', 'tp_director@test.local');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_flip, v_eq_cert, '__test_productions__eq with cert', 1);

  UPDATE public.production_crew SET student_id = v_stu_b WHERE id = v_crew_a;

  SELECT status INTO v_status FROM public.reservations_new WHERE id = v_res_flip;
  scenario := '3. cert-recheck flips reservation to ממתין';
  expected := 'ממתין';
  actual   := v_status;
  passed   := (v_status = 'ממתין');
  RETURN NEXT;

  UPDATE public.production_crew SET student_id = v_stu_a WHERE id = v_crew_a;

  INSERT INTO public.reservations_new
    (id, status, loan_type, borrow_date, borrow_time, return_date, return_time,
     production_id, student_name, email)
    VALUES (v_res_ok, 'מאושר', 'הפקה', '2027-04-02', '09:00', '2027-04-02', '12:00',
            v_prod_b, 'TP Director', 'tp_director@test.local');

  DELETE FROM public.productions WHERE id = v_prod_b;

  SELECT COUNT(*) INTO v_count FROM public.production_dates WHERE production_id = v_prod_b;
  scenario := '4a. production_dates cascade-deleted on parent delete';
  expected := '0';
  actual   := v_count::text;
  passed   := (v_count = 0);
  RETURN NEXT;

  SELECT production_id INTO v_status FROM public.reservations_new WHERE id = v_res_ok;
  scenario := '4b. reservation production_id SET NULL on parent delete';
  expected := '<null>';
  actual   := COALESCE(v_status, '<null>');
  passed   := (v_status IS NULL);
  RETURN NEXT;

  scenario := '5. create_reservation_v2 regression (no production)';
  expected := 'returned id';
  DECLARE v_id text;
  BEGIN
    v_id := public.create_reservation_v2(
      jsonb_build_object(
        'id', '__test_productions__res_noprod',
        'status', 'מאושר',
        'borrow_date', '2027-05-01', 'borrow_time', '09:00',
        'return_date', '2027-05-01', 'return_time', '12:00',
        'student_name', 'TP', 'email', 'tp@test.local',
        'loan_type', 'הפקה'
      ),
      jsonb_build_array(jsonb_build_object('equipment_id', v_eq_noc, 'name', 'noc', 'quantity', 1))
    );
    actual := v_id;
    passed := (v_id IS NOT NULL);
  END;
  RETURN NEXT;

  DELETE FROM public.reservation_items     WHERE reservation_id LIKE '__test_productions__%';
  DELETE FROM public.reservations_new      WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.production_crew       WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.production_dates      WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.productions           WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.student_certifications WHERE student_id     LIKE '__test_productions__%';
  DELETE FROM public.students              WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.certification_types   WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.equipment_units       WHERE id              LIKE '__test_productions__%';
  DELETE FROM public.equipment             WHERE id              LIKE '__test_productions__%';

  RETURN;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_productions_regression_tests() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_productions_regression_tests() TO service_role;
