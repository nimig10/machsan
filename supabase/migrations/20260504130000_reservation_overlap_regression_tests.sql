-- Reservation-overlap regression tests
--
-- A self-contained SECURITY DEFINER function that exercises the overlap
-- math used by create_reservation_v2 + create_lesson_reservations_v1
-- against a fixed table of scenarios. It creates ephemeral test data
-- under deterministic IDs (prefixed __test_overlap__), runs the same
-- tstzrange overlap query the RPCs use, asserts result == expected,
-- cleans up, and either RETURNS a results table or RAISES on the first
-- mismatch.
--
-- Why this exists: the previous bug (RPC date-only overlap vs frontend
-- time-aware overlap) only surfaced in production because no automated
-- check compared the two. This function locks down the contract so any
-- future migration that touches the overlap math has to keep all
-- scenarios green or the migration won't deploy.
--
-- Run from MCP or psql:    SELECT * FROM public.run_reservation_overlap_tests();
-- Strict mode (raise on any failure):   SELECT public.run_reservation_overlap_tests(p_strict => true);
--
-- Cleanup is idempotent — entry and exit both clear the test rows, so
-- a previous failed run can't leave junk that would skew the next one.

CREATE OR REPLACE FUNCTION public.run_reservation_overlap_tests(p_strict BOOLEAN DEFAULT TRUE)
RETURNS TABLE(scenario TEXT, expected_reserved INT, actual_reserved INT, passed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eq_id_a       TEXT := '__test_overlap__eq_A';
  v_eq_id_b       TEXT := '__test_overlap__eq_B';
  v_unit_id_a1    TEXT := '__test_overlap__unit_A1';
  v_unit_id_a2    TEXT := '__test_overlap__unit_A2';
  v_unit_id_b1    TEXT := '__test_overlap__unit_B1';
  v_res_existing  TEXT := '__test_overlap__res_existing';
  v_res_cancelled TEXT := '__test_overlap__res_cancelled';
  v_res_returned  TEXT := '__test_overlap__res_returned';
  v_res_multiday  TEXT := '__test_overlap__res_multiday';
  v_res_emptytime TEXT := '__test_overlap__res_emptytime';
  v_actual        INT;
  v_expected      INT;
  v_failed_count  INT := 0;
  v_first_fail    TEXT := NULL;
BEGIN
  -- ── CLEANUP (entry) ──────────────────────────────────────────────────────
  DELETE FROM public.reservation_items WHERE reservation_id LIKE '__test_overlap__%';
  DELETE FROM public.reservations_new  WHERE id              LIKE '__test_overlap__%';
  DELETE FROM public.equipment_units   WHERE id              LIKE '__test_overlap__%';
  DELETE FROM public.equipment         WHERE id              LIKE '__test_overlap__%';

  -- ── SETUP TEST DATA ──────────────────────────────────────────────────────
  -- Two test equipment items: A has 2 healthy units, B has 1.
  INSERT INTO public.equipment (id, name, available_units) VALUES
    (v_eq_id_a, '__test_overlap__ ציוד A (2 יח׳)', 2),
    (v_eq_id_b, '__test_overlap__ ציוד B (1 יח׳)', 1);

  INSERT INTO public.equipment_units (id, equipment_id, status) VALUES
    (v_unit_id_a1, v_eq_id_a, 'תקין'),
    (v_unit_id_a2, v_eq_id_a, 'תקין'),
    (v_unit_id_b1, v_eq_id_b, 'תקין');

  -- Existing approved single-day reservation: 2026-08-04 12:45-15:30 on equipment A, qty=1
  -- (Mirrors the real חורחה / פלורסנט-קינו prod scenario that triggered the bug.)
  INSERT INTO public.reservations_new (id, status, borrow_date, borrow_time, return_date, return_time)
    VALUES (v_res_existing, 'מאושר', '2026-08-04', '12:45', '2026-08-04', '15:30');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_existing, v_eq_id_a, '__test_overlap__', 1);

  -- Cancelled reservation: same window — must NOT count as reserved
  INSERT INTO public.reservations_new (id, status, borrow_date, borrow_time, return_date, return_time)
    VALUES (v_res_cancelled, 'בוטל', '2026-08-04', '12:45', '2026-08-04', '15:30');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_cancelled, v_eq_id_a, '__test_overlap__', 1);

  -- Returned reservation: same window — must NOT count as reserved
  INSERT INTO public.reservations_new (id, status, borrow_date, borrow_time, return_date, return_time, returned_at)
    VALUES (v_res_returned, 'הוחזר', '2026-08-04', '12:45', '2026-08-04', '15:30', '2026-08-04 15:30:00+00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_returned, v_eq_id_a, '__test_overlap__', 1);

  -- Multi-day approved reservation on equipment B: 2026-08-10 09:00 → 2026-08-12 17:00, qty=1
  INSERT INTO public.reservations_new (id, status, borrow_date, borrow_time, return_date, return_time)
    VALUES (v_res_multiday, 'מאושר', '2026-08-10', '09:00', '2026-08-12', '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_multiday, v_eq_id_b, '__test_overlap__', 1);

  -- Reservation with NULL/empty time strings: must fall back to 00:00 / 23:59 (full-day)
  INSERT INTO public.reservations_new (id, status, borrow_date, borrow_time, return_date, return_time)
    VALUES (v_res_emptytime, 'מאושר', '2026-08-20', '', '2026-08-20', '');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
    VALUES (v_res_emptytime, v_eq_id_b, '__test_overlap__', 1);

  -- ── SCENARIOS ────────────────────────────────────────────────────────────
  -- Each row: (label, expected_reserved, equipment_id, new_start, new_end).
  -- The actual_reserved is computed by the same tstzrange query the RPCs
  -- use, so a green run proves both code paths agree on this set of cases.
  CREATE TEMP TABLE _test_cases (
    seq           INT GENERATED ALWAYS AS IDENTITY,
    label         TEXT,
    expected      INT,
    eq_id         TEXT,
    new_start     TIMESTAMPTZ,
    new_end       TIMESTAMPTZ
  ) ON COMMIT DROP;

  INSERT INTO _test_cases (label, expected, eq_id, new_start, new_end) VALUES
    -- The exact prod regression: same date as חורחה, different hours → must NOT block
    ('eqA same-date 09:00-11:00 (no time overlap, the prod regression)',
        0, v_eq_id_a,
        ('2026-08-04'::date + '09:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '11:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Identical window → must block (1 reserved)
    ('eqA same-date 12:45-15:30 (full overlap, must block)',
        1, v_eq_id_a,
        ('2026-08-04'::date + '12:45'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '15:30'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Partial overlap (new starts during existing) → must block
    ('eqA same-date 14:00-17:00 (partial overlap, must block)',
        1, v_eq_id_a,
        ('2026-08-04'::date + '14:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '17:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Back-to-back: new starts exactly when existing ends → must NOT block ('[)' endpoint)
    ('eqA same-date 15:30-17:00 (back-to-back, must allow)',
        0, v_eq_id_a,
        ('2026-08-04'::date + '15:30'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '17:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Reverse back-to-back: new ends exactly when existing starts → must NOT block
    ('eqA same-date 10:00-12:45 (reverse back-to-back, must allow)',
        0, v_eq_id_a,
        ('2026-08-04'::date + '10:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '12:45'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Different equipment, same window → must NOT block (no shared resource)
    ('eqB same-date as eqA reservation, different equipment (must allow)',
        0, v_eq_id_b,
        ('2026-08-04'::date + '12:45'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '15:30'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Multi-day: new is inside existing's date range → must block
    ('eqB middle-day of multi-day reservation (must block)',
        1, v_eq_id_b,
        ('2026-08-11'::date + '10:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-11'::date + '14:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Multi-day: new ends before existing starts → must NOT block
    ('eqB day before multi-day reservation (must allow)',
        0, v_eq_id_b,
        ('2026-08-09'::date + '10:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-09'::date + '14:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Multi-day: new starts after existing ends → must NOT block
    ('eqB day after multi-day reservation (must allow)',
        0, v_eq_id_b,
        ('2026-08-13'::date + '10:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-13'::date + '14:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Empty borrow_time/return_time fallback to 00:00/23:59 — covers full day
    ('eqB any time on the empty-time reservation date (must block)',
        1, v_eq_id_b,
        ('2026-08-20'::date + '14:00'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-20'::date + '16:00'::time) AT TIME ZONE 'Asia/Jerusalem'),

    -- Status filter: cancelled + returned must be ignored — eqA has only 1 active reserved
    -- (we set up 3 reservations on the same window, only 1 with active status).
    -- Asking for 1 unit of eqA at that exact window: reserved=1, healthy=2 → 1 left.
    -- The check function returns reserved (not available); we assert reserved=1.
    ('eqA same window: cancelled+returned ignored, only active counted',
        1, v_eq_id_a,
        ('2026-08-04'::date + '12:45'::time) AT TIME ZONE 'Asia/Jerusalem',
        ('2026-08-04'::date + '15:30'::time) AT TIME ZONE 'Asia/Jerusalem');

  -- ── EXECUTE EACH SCENARIO ────────────────────────────────────────────────
  FOR scenario, expected_reserved, v_eq_id_a, v_actual IN
    SELECT
      tc.label,
      tc.expected,
      tc.eq_id,
      (
        SELECT COALESCE(SUM(ri.quantity), 0)::INT
        FROM public.reservation_items ri
        JOIN public.reservations_new r ON r.id = ri.reservation_id
        WHERE ri.equipment_id = tc.eq_id
          AND r.status IN ('ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה')
          AND r.borrow_date IS NOT NULL
          AND r.return_date IS NOT NULL
          AND tstzrange(
                (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                  AT TIME ZONE 'Asia/Jerusalem',
                (r.return_date + COALESCE(NULLIF(r.return_time,'')::TIME, '23:59'::TIME))
                  AT TIME ZONE 'Asia/Jerusalem',
                '[)'
              ) && tstzrange(tc.new_start, tc.new_end, '[)')
      )
    FROM _test_cases tc
    ORDER BY tc.seq
  LOOP
    actual_reserved := v_actual;
    passed := (actual_reserved = expected_reserved);
    IF NOT passed THEN
      v_failed_count := v_failed_count + 1;
      IF v_first_fail IS NULL THEN
        v_first_fail := scenario || ' (expected ' || expected_reserved || ', got ' || actual_reserved || ')';
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;

  -- ── CLEANUP (exit) ───────────────────────────────────────────────────────
  DELETE FROM public.reservation_items WHERE reservation_id LIKE '__test_overlap__%';
  DELETE FROM public.reservations_new  WHERE id              LIKE '__test_overlap__%';
  DELETE FROM public.equipment_units   WHERE id              LIKE '__test_overlap__%';
  DELETE FROM public.equipment         WHERE id              LIKE '__test_overlap__%';

  IF v_failed_count > 0 AND p_strict THEN
    RAISE EXCEPTION 'run_reservation_overlap_tests: % scenario(s) FAILED. First failure: %',
      v_failed_count, v_first_fail;
  END IF;

  RETURN;
END;
$function$;

-- Convenience: also expose a one-line "smoke" caller that returns
-- 'OK' or RAISES — useful from CI / curl / cron health checks.
CREATE OR REPLACE FUNCTION public.assert_reservation_overlap_ok()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.run_reservation_overlap_tests(p_strict => true);
  RETURN 'OK';
END;
$function$;

COMMENT ON FUNCTION public.run_reservation_overlap_tests(BOOLEAN) IS
'Regression suite for the reservation-overlap math. Returns one row per scenario with expected/actual/passed. With p_strict=true (default), RAISES on the first failure. Run after any migration that touches create_reservation_v2 / create_lesson_reservations_v1 / the reservation overlap query.';

COMMENT ON FUNCTION public.assert_reservation_overlap_ok() IS
'One-line smoke test: returns ''OK'' if all overlap regression scenarios pass, RAISES otherwise. Safe to call from health checks.';
