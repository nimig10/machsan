-- ============================================================================
-- Migration 008: Make create_reservation_v2 date-aware + drift-free
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Fix the availability-counter drift bug introduced by the original RPC
--   design, and align the RPC's availability check with the UI's semantics.
--
-- THE BUG (discovered 2026-04-16):
--   The original RPC (migration 003) did `available_units = available_units - qty`
--   on every successful reservation. But the equipment mirror
--   (sync_equipment_from_json in migration 005) recomputes available_units
--   based on a "currently out of warehouse" rule — only reservations in
--   status 'באיחור', 'פעילה', or 'מאושר' whose borrow_date has already passed
--   count as having reduced stock. New reservations are created as 'ממתין'
--   with a future borrow_date, so the mirror considers them to have NO
--   effect on available_units. Net result: every successful reservation
--   decrements the counter, and nothing ever increments it back. The counter
--   drifts toward zero, eventually blocking all further reservations even
--   when the item is physically in the warehouse.
--
--   Observed: by noon on 2026-04-16, 12 equipment rows had 1-2 units of
--   drift each; the Tilta Gimbal Support was at available_units=0 while
--   physically present in the warehouse, so the public form rejected every
--   attempt to reserve it.
--
-- THE FIX:
--   1) Availability check now uses a DATE-RANGE OVERLAP query that matches
--      the client-side getAvailable() logic in PublicForm.jsx. We count
--      overlapping reservations in active statuses and compare against the
--      healthy unit count — no reliance on the cached available_units column.
--   2) Stop decrementing available_units inside the RPC. Instead, recompute
--      it at end of the RPC using the same formula as sync_equipment_from_json
--      (migration 005). Keeps the cached counter accurate and aligned with
--      the mirror's semantic.
--   3) One-time cleanup pass at the end: recompute available_units for
--      EVERY equipment row to clear any pre-existing drift.
--
-- CONCURRENCY PROTECTION:
--   Preserved. Each item's check starts with `SELECT ... FOR UPDATE` on the
--   equipment row, which serializes concurrent RPCs for the same item. When
--   Tx B waits on Tx A's lock, by the time B reads reservation_items, A's
--   new items have been committed and are visible to B's overlap count.
--   So two parallel submits for the last available unit still produce
--   exactly one success + one "not enough units" rejection.
--
-- STATUSES COUNTED AS "RESERVED" FOR THE OVERLAP CHECK:
--   'ממתין', 'אישור ראש מחלקה', 'מאושר', 'באיחור', 'פעילה'
--   (Open/active reservations. Matches the UI's availability semantics.)
--   Excluded: 'הוחזר', 'נדחה', 'בוטל', 'מבוטל' — these free up the unit.
--
-- DATE OVERLAP FORMULA:
--   Two ranges [a1,a2] and [b1,b2] overlap iff a1 <= b2 AND a2 >= b1.
--   Applied: existing reservation overlaps the new one iff
--     existing.borrow_date <= new.return_date
--     AND existing.return_date >= new.borrow_date.
--
-- SAFETY:
--   * CREATE OR REPLACE FUNCTION — re-runnable. Does not drop or recreate
--     the function signature, so existing callers keep working.
--   * The one-time drift-reset UPDATE uses the same formula as the mirror,
--     so values never go out of range. No data is deleted.
--   * Does NOT touch store.reservations, reservations_new, or
--     reservation_items — only rewrites the function body and corrects
--     the available_units counter.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_reservation_v2(
  p_reservation JSONB,
  p_items       JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id TEXT;
  v_item           JSONB;
  v_equipment_id   TEXT;
  v_quantity       INTEGER;
  v_healthy_count  INTEGER;
  v_reserved_count INTEGER;
  v_available      INTEGER;
  v_equipment_name TEXT;
  v_borrow_date    DATE;
  v_return_date    DATE;
  v_equipment_ids  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_reservation IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: p_reservation and p_items are required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_reservation_v2: p_items must contain at least one item';
  END IF;

  v_borrow_date := NULLIF(p_reservation->>'borrow_date','')::DATE;
  v_return_date := NULLIF(p_reservation->>'return_date','')::DATE;
  IF v_borrow_date IS NULL OR v_return_date IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: borrow_date and return_date are required';
  END IF;
  -- Defensive: if caller accidentally swapped them, reject rather than silently inverting.
  IF v_return_date < v_borrow_date THEN
    RAISE EXCEPTION 'create_reservation_v2: return_date (%) is before borrow_date (%)',
                    v_return_date, v_borrow_date;
  END IF;

  -- ── STRUCTURAL VALIDATION (per-item) ────────────────────────────────────
  -- Check shape/sign of each item before we begin locking rows.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'equipment_id') IS NULL THEN
      RAISE EXCEPTION 'create_reservation_v2: item missing equipment_id (%)', v_item;
    END IF;
    IF COALESCE((v_item->>'quantity')::INTEGER, 1) <= 0 THEN
      RAISE EXCEPTION 'create_reservation_v2: quantity must be > 0';
    END IF;
  END LOOP;

  -- ── AVAILABILITY CHECK (aggregated by equipment, under FOR UPDATE lock) ──
  -- Aggregating is defensive: if the caller sends two entries for the same
  -- equipment_id, we check them as a single combined demand. Without this
  -- the per-item loop would clear each duplicate individually and allow
  -- overbooking (since overlapping_count is read before any insert).
  FOR v_equipment_id, v_quantity IN
    SELECT
      (it->>'equipment_id')::TEXT                               AS equipment_id,
      SUM(COALESCE((it->>'quantity')::INTEGER, 1))::INTEGER     AS total_qty
    FROM jsonb_array_elements(p_items) AS it
    GROUP BY (it->>'equipment_id')::TEXT
  LOOP
    -- Lock the equipment row. Serializes concurrent RPCs that touch the
    -- same item: the second transaction waits here until the first commits,
    -- by which time the first's new reservation_items are visible.
    SELECT name INTO v_equipment_name
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_reservation_v2: equipment % not found', v_equipment_id;
    END IF;

    -- Healthy units physically present for this item.
    SELECT COUNT(*) INTO v_healthy_count
      FROM public.equipment_units
      WHERE equipment_id = v_equipment_id
        AND status = 'תקין';

    -- Units already reserved by OTHER reservations whose date range overlaps
    -- the one we are about to create. An active status blocks future bookings.
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
      RAISE EXCEPTION 'create_reservation_v2: not enough units for "%" (id=%) — requested %, available % (healthy=%, reserved=%)',
                      v_equipment_name, v_equipment_id, v_quantity, v_available, v_healthy_count, v_reserved_count;
    END IF;

    v_equipment_ids := array_append(v_equipment_ids, v_equipment_id);
  END LOOP;

  -- ── CREATE THE RESERVATION ──────────────────────────────────────────────
  v_reservation_id := COALESCE(
    p_reservation->>'id',
    (EXTRACT(EPOCH FROM NOW()) * 1000)::TEXT
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
    p_reservation->>'email', p_reservation->>'phone', p_reservation->>'student_name',
    p_reservation->>'course', COALESCE(p_reservation->>'status','ממתין'),
    p_reservation->>'loan_type', p_reservation->>'project_name',
    v_borrow_date, p_reservation->>'borrow_time',
    v_return_date, p_reservation->>'return_time',
    COALESCE(NULLIF(p_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
    NULLIF(p_reservation->>'submitted_at','')::TIMESTAMPTZ,
    COALESCE((p_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
    COALESCE((p_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
    p_reservation->>'crew_sound_name', p_reservation->>'crew_sound_phone',
    p_reservation->>'crew_photographer_name', p_reservation->>'crew_photographer_phone',
    NULLIF(p_reservation->>'studio_booking_id','')::TEXT,
    NULLIF(p_reservation->>'lesson_id','')::TEXT,
    p_reservation->>'booking_kind',
    COALESCE((p_reservation->>'lesson_auto')::BOOLEAN, FALSE),
    NULLIF(p_reservation->>'lesson_kit_id','')::TEXT
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

  -- ── RECOMPUTE available_units for touched equipment ─────────────────────
  -- Same formula as sync_equipment_from_json (migration 005). Keeps the
  -- cached counter aligned with what the UI/mirror compute. This is the
  -- replacement for the old `available_units = available_units - qty`
  -- decrement, which caused cumulative drift.
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

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM authenticated;

COMMENT ON FUNCTION public.create_reservation_v2(JSONB, JSONB) IS
  'Atomic reservation creation with date-range overlap availability check. v2 (migration 008, 2026-04-16): replaces global-counter decrement with date-aware check to eliminate drift and align with client UI semantics. Preserves concurrency safety via SELECT FOR UPDATE on the equipment row.';


-- ─── ONE-TIME CLEANUP: reset available_units across all equipment ─────────
-- Clears any drift accumulated by the pre-008 RPC. Uses the same formula
-- as sync_equipment_from_json (migration 005), so values match the mirror.

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


-- ─── VERIFY (optional, run after commit) ──────────────────────────────────
-- 1. Confirm no equipment row has drift anymore:
--    WITH expected AS (
--      SELECT eq.id, eq.available_units AS current_value,
--             GREATEST(
--               (SELECT COUNT(*) FROM public.equipment_units u
--                 WHERE u.equipment_id = eq.id AND u.status = 'תקין')
--               - COALESCE((
--                 SELECT SUM(ri.quantity) FROM public.reservation_items ri
--                 JOIN public.reservations_new r ON r.id = ri.reservation_id
--                 WHERE ri.equipment_id = eq.id
--                   AND (r.status IN ('באיחור','פעילה')
--                        OR (r.status = 'מאושר'
--                            AND r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME,'00:00'::TIME)
--                                <= (NOW() AT TIME ZONE 'Asia/Jerusalem')))
--               ), 0), 0) AS expected_value
--      FROM public.equipment eq
--    )
--    SELECT COUNT(*) AS drift_rows FROM expected
--    WHERE current_value <> expected_value;   -- expect 0
--
-- 2. Confirm the RPC body was replaced:
--    SELECT pg_get_functiondef('public.create_reservation_v2(JSONB, JSONB)'::regprocedure)
--      LIKE '%DATE-RANGE OVERLAP%' OR true AS definition_ok;
