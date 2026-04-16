-- ============================================================================
-- Migration 010: Batch RPC for lesson-kit reservations
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Stage 2b of the atomic-RPC migration. When an admin saves a lesson kit
--   (course + weekly schedule) the app currently does:
--
--     baseRes = reservations.filter(r => r.lesson_kit_id !== kitId)
--     newRes  = finalSchedule.map(s => { ... })
--     storageSet("reservations", [...baseRes, ...newRes])
--
--   That full-list overwrite has three problems, identical in kind to the ones
--   migrations 008/009 already eliminated for create / status-change paths:
--
--     1) Racing with a concurrent public-form submit: the JSON blob the admin
--        fetched can be stale by the time it writes back, so a fresh student
--        reservation can be silently dropped. The 60-second grace period from
--        migration 007 narrows the practical window but does not close it —
--        if the blob write beats the mirror's next sync cycle, the student's
--        row vanishes from the cache until the next cycle.
--     2) No per-session availability check. A kit can define 10 weekly sessions
--        on the same item; if any one of them collides with a private booking
--        we only learn about it after the write.
--     3) No intra-kit availability check. Saving a kit with two sessions that
--        fight each other for a 2-unit item "works" via storageSet but leaves
--        the mirror with negative available_units. The UI client-side check
--        handles this today (App.jsx:4816-4854), but there is no backstop.
--
-- THIS RPC:
--   create_lesson_reservations_v1(kit_id, p_reservations[], p_items)
--
--   1) Deletes all existing reservations where lesson_kit_id = kit_id
--      (each kit owns its schedule; re-saving a kit replaces the set).
--   2) For each session in p_reservations, runs the same date-range overlap
--      availability check as create_reservation_v2 — but EXCLUDING the
--      rows it just deleted AND counting sessions inserted earlier in this
--      same call. So intra-kit collisions are caught, and two kits that
--      share an item on the same day serialize through the FOR UPDATE lock.
--   3) Inserts the session reservation + its items.
--   4) Recomputes available_units for every equipment_id the kit touches,
--      using the migration 005/008 formula.
--
-- CONCURRENCY:
--   Each session loop starts with SELECT ... FOR UPDATE on every distinct
--   equipment_id the kit touches (locked once at the top of the function,
--   so the lock is held across all sessions). That means: while this RPC
--   runs, no other RPC can reserve the same items. A concurrent public-form
--   submit for the same item will wait until the kit is fully committed,
--   then re-check against the freshly-visible lesson rows.
--
-- RETURNS:
--   JSONB { inserted: <n>, deleted: <n>, ids: [<text>, ...] }
--
-- STATUSES COUNTED AS "RESERVED" FOR THE OVERLAP CHECK:
--   'ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה'
--   (same taxonomy as migration 008)
--
-- SAFETY:
--   * CREATE OR REPLACE — re-runnable.
--   * The DELETE is scoped strictly to lesson_kit_id = p_kit_id. It cannot
--     touch reservations belonging to other kits, private bookings, or
--     lesson rows from a different kit.
--   * If ANY session fails the availability check, we RAISE EXCEPTION and
--     the transaction rolls back — the delete is undone. Callers see an
--     error; the database state is unchanged.
--   * Items on each reservation are validated (equipment_id present,
--     quantity > 0) before any lock is acquired.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_lesson_reservations_v1(
  p_kit_id        TEXT,
  p_reservations  JSONB,
  p_items         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation      JSONB;
  v_item             JSONB;
  v_equipment_id     TEXT;
  v_quantity         INTEGER;
  v_equipment_name   TEXT;
  v_borrow_date      DATE;
  v_return_date      DATE;
  v_reservation_id   TEXT;
  v_deleted_count    INTEGER := 0;
  v_inserted_count   INTEGER := 0;
  v_inserted_ids     TEXT[]  := ARRAY[]::TEXT[];
  v_equipment_ids    TEXT[]  := ARRAY[]::TEXT[];
  v_healthy_count    INTEGER;
  v_reserved_count   INTEGER;
  v_available        INTEGER;
  v_session_index    INTEGER;
  v_session_label    TEXT;
BEGIN
  IF p_kit_id IS NULL OR p_kit_id = '' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_kit_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_items must be a JSONB array';
  END IF;
  IF p_reservations IS NULL OR jsonb_typeof(p_reservations) <> 'array' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_reservations must be a JSONB array';
  END IF;

  -- ── STRUCTURAL VALIDATION (items) ────────────────────────────────────────
  -- Check every item has equipment_id + positive quantity before locking.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'equipment_id') IS NULL THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: item missing equipment_id (%)', v_item;
    END IF;
    IF COALESCE((v_item->>'quantity')::INTEGER, 1) <= 0 THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: item quantity must be > 0';
    END IF;
  END LOOP;

  -- ── STRUCTURAL VALIDATION (reservations) ─────────────────────────────────
  -- Require non-null dates with return_date >= borrow_date on every session.
  FOR v_reservation IN SELECT * FROM jsonb_array_elements(p_reservations) LOOP
    v_borrow_date := NULLIF(v_reservation->>'borrow_date','')::DATE;
    v_return_date := NULLIF(v_reservation->>'return_date','')::DATE;
    IF v_borrow_date IS NULL OR v_return_date IS NULL THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: every session needs borrow_date and return_date (got %)', v_reservation;
    END IF;
    IF v_return_date < v_borrow_date THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: return_date (%) before borrow_date (%) on session %',
                      v_return_date, v_borrow_date, v_reservation;
    END IF;
  END LOOP;

  -- ── DELETE EXISTING ROWS FOR THIS KIT ────────────────────────────────────
  -- Child rows in reservation_items are cleared via ON DELETE CASCADE
  -- (see migration 001). If a future migration changes that, the deletion
  -- below would have to be rewritten as two statements.
  WITH del AS (
    DELETE FROM public.reservations_new
     WHERE lesson_kit_id = p_kit_id
     RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_deleted_count FROM del;

  -- If there are no sessions to insert, just recompute available_units
  -- for items this call touches (none here, beyond what DELETE changed —
  -- so we fall back to touching all rows, which is cheap). Return early.
  IF jsonb_array_length(p_reservations) = 0 THEN
    -- Only re-sync equipment that lost rows in this txn (best-effort);
    -- if the caller deleted nothing and sent no sessions, we skip the scan.
    IF v_deleted_count > 0 THEN
      UPDATE public.equipment eq
      SET available_units = GREATEST(
            (
              SELECT COUNT(*)
              FROM public.equipment_units u
              WHERE u.equipment_id = eq.id
                AND u.status = 'תקין'
            )
            - COALESCE(
              (
                SELECT SUM(ri.quantity)
                FROM public.reservation_items ri
                JOIN public.reservations_new r ON r.id = ri.reservation_id
                WHERE ri.equipment_id = eq.id
                  AND (
                    r.status IN ('באיחור', 'פעילה')
                    OR (
                      r.status = 'מאושר'
                      AND r.borrow_date IS NOT NULL
                      AND (
                        r.borrow_date
                        + COALESCE(NULLIF(r.borrow_time, '')::TIME, '00:00'::TIME)
                      ) <= (NOW() AT TIME ZONE 'Asia/Jerusalem')
                    )
                  )
              ), 0
            ),
            0
          ),
          updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
      'inserted', 0,
      'deleted',  v_deleted_count,
      'ids',      to_jsonb(ARRAY[]::TEXT[])
    );
  END IF;

  -- ── LOCK EVERY EQUIPMENT ROW THE KIT TOUCHES ─────────────────────────────
  -- One lock pass, held for the rest of the txn. All per-session overlap
  -- checks below therefore see a consistent snapshot of reservation_items.
  FOR v_equipment_id IN
    SELECT DISTINCT (it->>'equipment_id')::TEXT
    FROM jsonb_array_elements(p_items) AS it
  LOOP
    SELECT name INTO v_equipment_name
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: equipment % not found', v_equipment_id;
    END IF;
    v_equipment_ids := array_append(v_equipment_ids, v_equipment_id);
  END LOOP;

  -- ── INSERT SESSIONS ──────────────────────────────────────────────────────
  -- For each session:
  --   1) Aggregate requested quantity per equipment_id (defensive against
  --      duplicate entries for the same item).
  --   2) Re-check overlap against reservations_new — the kit's old rows
  --      were just deleted so this picks up only OTHER reservations plus
  --      sessions of THIS kit inserted in earlier iterations.
  --   3) Insert reservations_new row + reservation_items rows.
  v_session_index := 0;
  FOR v_reservation IN SELECT * FROM jsonb_array_elements(p_reservations) LOOP
    v_session_index := v_session_index + 1;
    v_borrow_date   := (v_reservation->>'borrow_date')::DATE;
    v_return_date   := (v_reservation->>'return_date')::DATE;
    v_session_label := COALESCE(v_reservation->>'id',
                                'session #' || v_session_index::TEXT);

    -- Per-equipment overlap check for this session.
    FOR v_equipment_id, v_quantity IN
      SELECT
        (it->>'equipment_id')::TEXT                             AS equipment_id,
        SUM(COALESCE((it->>'quantity')::INTEGER, 1))::INTEGER   AS total_qty
      FROM jsonb_array_elements(p_items) AS it
      GROUP BY (it->>'equipment_id')::TEXT
    LOOP
      SELECT COUNT(*) INTO v_healthy_count
        FROM public.equipment_units
        WHERE equipment_id = v_equipment_id
          AND status = 'תקין';

      SELECT COALESCE(SUM(ri.quantity), 0) INTO v_reserved_count
        FROM public.reservation_items ri
        JOIN public.reservations_new r ON r.id = ri.reservation_id
        WHERE ri.equipment_id = v_equipment_id
          AND r.status IN ('ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה')
          AND r.borrow_date IS NOT NULL
          AND r.return_date IS NOT NULL
          AND r.borrow_date <= v_return_date
          AND r.return_date >= v_borrow_date;

      v_available := v_healthy_count - v_reserved_count;
      IF v_available < v_quantity THEN
        SELECT name INTO v_equipment_name
          FROM public.equipment WHERE id = v_equipment_id;
        RAISE EXCEPTION 'create_lesson_reservations_v1: not enough units for "%" (id=%) on % (%) — requested %, available % (healthy=%, reserved=%)',
                        v_equipment_name, v_equipment_id, v_borrow_date, v_session_label,
                        v_quantity, v_available, v_healthy_count, v_reserved_count;
      END IF;
    END LOOP;

    -- Insert reservation row. Id comes from caller if present, otherwise
    -- we build one matching the client's `${kitId}_s${i}` convention so
    -- existing consumers that key by this id keep working.
    v_reservation_id := COALESCE(
      NULLIF(v_reservation->>'id',''),
      p_kit_id || '_s' || (v_session_index - 1)::TEXT
    );

    INSERT INTO public.reservations_new (
      id, email, phone, student_name, course, status, loan_type, project_name,
      borrow_date, borrow_time, return_date, return_time,
      created_at, submitted_at,
      sound_day_loan, sound_night_loan,
      crew_sound_name, crew_sound_phone,
      crew_photographer_name, crew_photographer_phone,
      studio_booking_id, lesson_id, booking_kind, lesson_auto, lesson_kit_id
    ) VALUES (
      v_reservation_id,
      v_reservation->>'email', v_reservation->>'phone', v_reservation->>'student_name',
      v_reservation->>'course',
      COALESCE(v_reservation->>'status','מאושר'),
      COALESCE(v_reservation->>'loan_type','שיעור'),
      v_reservation->>'project_name',
      v_borrow_date, v_reservation->>'borrow_time',
      v_return_date, v_reservation->>'return_time',
      COALESCE(NULLIF(v_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
      NULLIF(v_reservation->>'submitted_at','')::TIMESTAMPTZ,
      COALESCE((v_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
      COALESCE((v_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
      v_reservation->>'crew_sound_name', v_reservation->>'crew_sound_phone',
      v_reservation->>'crew_photographer_name', v_reservation->>'crew_photographer_phone',
      NULLIF(v_reservation->>'studio_booking_id','')::TEXT,
      NULLIF(v_reservation->>'lesson_id','')::TEXT,
      COALESCE(v_reservation->>'booking_kind','lesson'),
      COALESCE((v_reservation->>'lesson_auto')::BOOLEAN, TRUE),
      p_kit_id
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity, unit_id)
      VALUES (
        v_reservation_id,
        (v_item->>'equipment_id')::TEXT,
        v_item->>'name',
        COALESCE((v_item->>'quantity')::INTEGER, 1),
        v_item->>'unit_id'
      );
    END LOOP;

    v_inserted_count := v_inserted_count + 1;
    v_inserted_ids   := array_append(v_inserted_ids, v_reservation_id);
  END LOOP;

  -- ── RECOMPUTE available_units FOR TOUCHED EQUIPMENT ──────────────────────
  -- Same formula as migration 005/008. Keeps the cached counter aligned
  -- with the mirror and with the UI's availability semantics.
  UPDATE public.equipment eq
  SET available_units = GREATEST(
        (
          SELECT COUNT(*)
          FROM public.equipment_units u
          WHERE u.equipment_id = eq.id
            AND u.status = 'תקין'
        )
        - COALESCE(
          (
            SELECT SUM(ri.quantity)
            FROM public.reservation_items ri
            JOIN public.reservations_new r ON r.id = ri.reservation_id
            WHERE ri.equipment_id = eq.id
              AND (
                r.status IN ('באיחור', 'פעילה')
                OR (
                  r.status = 'מאושר'
                  AND r.borrow_date IS NOT NULL
                  AND (
                    r.borrow_date
                    + COALESCE(NULLIF(r.borrow_time, '')::TIME, '00:00'::TIME)
                  ) <= (NOW() AT TIME ZONE 'Asia/Jerusalem')
                )
              )
          ), 0
        ),
        0
      ),
      updated_at = NOW()
  WHERE eq.id = ANY(v_equipment_ids);

  RETURN jsonb_build_object(
    'inserted', v_inserted_count,
    'deleted',  v_deleted_count,
    'ids',      to_jsonb(v_inserted_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_lesson_reservations_v1(TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_lesson_reservations_v1(TEXT, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.create_lesson_reservations_v1(TEXT, JSONB, JSONB) FROM authenticated;

COMMENT ON FUNCTION public.create_lesson_reservations_v1(TEXT, JSONB, JSONB) IS
  'Atomic batch creation of lesson-kit reservations (one per session). Migration 010, 2026-04-16. Deletes existing rows for the kit, re-checks availability per session with FOR UPDATE on every touched equipment, inserts all sessions + items, and recomputes available_units. Rolls back entirely on any session conflict.';


-- ─── VERIFY (optional, run after commit) ──────────────────────────────────
-- 1. Confirm function is in place:
--    SELECT proname FROM pg_proc WHERE proname = 'create_lesson_reservations_v1';
--
-- 2. Smoke test (dry-run — rolls back, so safe on prod):
--    BEGIN;
--      SELECT public.create_lesson_reservations_v1(
--        'lk_test_' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
--        '[]'::JSONB,
--        '[]'::JSONB
--      );
--    ROLLBACK;
--    -- Should return {"inserted":0,"deleted":0,"ids":[]}.
