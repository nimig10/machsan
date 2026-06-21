-- Atomic, race-proof guard against overlapping studio bookings.
--
-- Problem: studio_bookings had NO server-side overlap enforcement — every check
-- was client-side against a possibly-stale in-memory array, then a direct write.
-- Under a race / stale realtime state two actors could both pass their local
-- check and both write → a double booking on the same room/time. (Equipment
-- reservations are protected atomically by create_reservation_v2; studio
-- bookings had nothing equivalent.)
--
-- This migration adds a partial GIST EXCLUDE constraint so the DATABASE rejects
-- any second booking whose time range overlaps an existing one on the same
-- studio. It covers PERSISTED rows only (student + team). lesson_auto bookings
-- are never stored in this table (regenerated in-memory from lessons.schedule),
-- so lesson↔booking conflicts stay in the client check by design.
--
-- date / start_time / end_time are TEXT (YYYY-MM-DD / HH:MM). We build the range
-- with make_timestamp (IMMUTABLE — unlike text::timestamp which is STABLE and so
-- cannot appear in an index/constraint expression). Wall-clock (no timezone) is
-- sufficient because we only ever compare two bookings against each other.
-- Night bookings store 21:30 → 08:00; the generic "end <= start → +1 day" wrap
-- handles them with no is_night special-case.
--
-- ⚠️ Existing overlapping rows will make the ALTER TABLE fail. Resolve them first
--    (see the dedup query below) before applying this migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.studio_booking_tsrange(p_date text, p_start text, p_end text)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_date IS NULL OR p_start IS NULL OR p_end IS NULL
      OR length(p_date) < 10 OR length(p_start) < 5 OR length(p_end) < 5
    THEN NULL
    ELSE tsrange(
      make_timestamp(
        substr(p_date, 1, 4)::int, substr(p_date, 6, 2)::int, substr(p_date, 9, 2)::int,
        substr(p_start, 1, 2)::int, substr(p_start, 4, 2)::int, 0),
      make_timestamp(
        substr(p_date, 1, 4)::int, substr(p_date, 6, 2)::int, substr(p_date, 9, 2)::int,
        substr(p_end, 1, 2)::int, substr(p_end, 4, 2)::int, 0)
        + CASE WHEN p_end <= p_start THEN interval '1 day' ELSE interval '0' END, -- night wrap 21:30→08:00
      '[)')
  END
$function$;

-- ── Dedup pre-check (run manually BEFORE the ALTER below; data cleanup is a
--    human decision — which of the two overlapping bookings to keep) ──────────
--
--   SELECT a.id, b.id, a.studio_id, a.date,
--          a.start_time a_s, a.end_time a_e, a.booking_kind a_k, a.student_name a_who,
--          b.start_time b_s, b.end_time b_e, b.booking_kind b_k, b.student_name b_who
--   FROM public.studio_bookings a
--   JOIN public.studio_bookings b
--     ON a.studio_id = b.studio_id AND a.id < b.id
--    AND a.lesson_auto = false AND b.lesson_auto = false
--    AND coalesce(a.status,'') <> 'נדחה' AND coalesce(b.status,'') <> 'נדחה'
--    AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
--    AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
--    AND public.studio_booking_tsrange(a.date, a.start_time, a.end_time)
--      && public.studio_booking_tsrange(b.date, b.start_time, b.end_time);

-- ── The constraint: no two ACTIVE persisted bookings may overlap on a studio ──
ALTER TABLE public.studio_bookings
  DROP CONSTRAINT IF EXISTS studio_bookings_no_overlap;

ALTER TABLE public.studio_bookings
  ADD CONSTRAINT studio_bookings_no_overlap
  EXCLUDE USING gist (
    studio_id WITH =,
    public.studio_booking_tsrange(date, start_time, end_time) WITH &&
  )
  WHERE (
    lesson_auto = false
    AND coalesce(status, '') <> 'נדחה'
    AND start_time IS NOT NULL
    AND end_time IS NOT NULL
  );


-- ── CI regression test ──────────────────────────────────────────────────────
-- Asserts the EXCLUDE constraint blocks overlaps and lets non-overlaps through.
-- Mirrors run_student_overlap_tests: one row per scenario, RAISEs under strict
-- mode so the DB-smoke harness exits non-zero on any failure.
CREATE OR REPLACE FUNCTION public.run_studio_overlap_tests(p_strict BOOLEAN DEFAULT TRUE)
RETURNS TABLE(scenario TEXT, expected TEXT, actual TEXT, passed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_st     TEXT := '__test_stlap__studio';
  v_failed INT  := 0;
  v_first  TEXT := NULL;
BEGIN
  -- clean any leftovers
  DELETE FROM public.studio_bookings WHERE id LIKE '__test_stlap__%';

  -- ── T1: two overlapping team day bookings, same studio → second blocked ────
  scenario := 'T1: overlapping team day bookings → blocked';
  expected := 'blocked';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
    VALUES ('__test_stlap__t1a', v_st, '2027-03-01', '10:00', '12:00', false, 'team', NULL);
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t1b', v_st, '2027-03-01', '11:00', '13:00', false, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- ── T2: night vs night on the same studio/date → blocked ──────────────────
  scenario := 'T2: night vs night same studio → blocked';
  expected := 'blocked';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
    VALUES ('__test_stlap__t2a', v_st, '2027-03-02', '21:30', '08:00', true, 'student', NULL);
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t2b', v_st, '2027-03-02', '21:30', '08:00', true, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- ── T3: student vs team overlapping → blocked (cross-type) ────────────────
  scenario := 'T3: student vs team overlap → blocked';
  expected := 'blocked';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
    VALUES ('__test_stlap__t3a', v_st, '2027-03-03', '14:00', '16:00', false, 'student', NULL);
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t3b', v_st, '2027-03-03', '15:00', '17:00', false, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- ── T4: adjacent, non-overlapping windows → allowed (half-open '[)') ───────
  scenario := 'T4: adjacent non-overlapping → allowed';
  expected := 'allowed';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
    VALUES ('__test_stlap__t4a', v_st, '2027-03-04', '10:00', '12:00', false, 'team', NULL);
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t4b', v_st, '2027-03-04', '12:00', '14:00', false, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- ── T5: an overlapping but REJECTED booking does not block → allowed ───────
  scenario := 'T5: overlaps only a rejected booking → allowed';
  expected := 'allowed';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
    VALUES ('__test_stlap__t5a', v_st, '2027-03-05', '10:00', '12:00', false, 'team', 'נדחה');
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t5b', v_st, '2027-03-05', '11:00', '13:00', false, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- ── T6: a lesson_auto booking is not enforced → allowed ───────────────────
  scenario := 'T6: overlaps only a lesson_auto row → allowed';
  expected := 'allowed';
  INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, lesson_auto, status)
    VALUES ('__test_stlap__t6a', v_st, '2027-03-06', '10:00', '12:00', false, 'lesson', true, NULL);
  BEGIN
    INSERT INTO public.studio_bookings (id, studio_id, date, start_time, end_time, is_night, booking_kind, status)
      VALUES ('__test_stlap__t6b', v_st, '2027-03-06', '11:00', '13:00', false, 'team', NULL);
    actual := 'allowed';
  EXCEPTION WHEN exclusion_violation THEN actual := 'blocked';
           WHEN OTHERS THEN actual := 'error:' || SQLERRM;
  END;
  passed := (actual = expected);
  IF NOT passed THEN v_failed := v_failed + 1; v_first := COALESCE(v_first, scenario || ' got ' || actual); END IF;
  RETURN NEXT;

  -- cleanup
  DELETE FROM public.studio_bookings WHERE id LIKE '__test_stlap__%';

  IF v_failed > 0 AND p_strict THEN
    RAISE EXCEPTION 'run_studio_overlap_tests: % scenario(s) FAILED. First: %', v_failed, v_first;
  END IF;
  RETURN;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_studio_overlap_tests(BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_studio_overlap_tests(BOOLEAN) TO service_role;
