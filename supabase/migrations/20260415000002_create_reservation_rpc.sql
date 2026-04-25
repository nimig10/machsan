-- ============================================================================
-- Migration 002: Atomic reservation RPC
-- ----------------------------------------------------------------------------
-- SAFETY:
--   * Pure CREATE FUNCTION. No schema or data changes to existing tables.
--   * Safe to re-run (CREATE OR REPLACE).
--   * Operates only on the NEW tables (equipment, reservations_new,
--     reservation_items). Does NOT touch the `store` JSON table.
-- ----------------------------------------------------------------------------
-- What this solves:
--   Race conditions on equipment availability. Two users booking the last
--   unit at the same time — Postgres SELECT ... FOR UPDATE serializes them,
--   and the second caller gets a clear "not enough units" error instead
--   of silently overwriting the first booking.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-15
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_reservation_v2(
  p_reservation JSONB,  -- reservation header fields
  p_items       JSONB   -- array of {equipment_id, quantity, name?}
)
RETURNS BIGINT           -- the reservation id on success
LANGUAGE plpgsql
SECURITY DEFINER         -- runs with owner privileges so RLS doesn't block internal writes
SET search_path = public -- prevent search_path hijacking
AS $$
DECLARE
  v_reservation_id BIGINT;
  v_item           JSONB;
  v_equipment_id   BIGINT;
  v_quantity       INTEGER;
  v_available      INTEGER;
  v_equipment_name TEXT;
BEGIN
  -- ── Validate input ────────────────────────────────────────────────────────
  IF p_reservation IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: p_reservation and p_items are required';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_reservation_v2: p_items must contain at least one item';
  END IF;

  -- ── Lock and validate availability for every item ─────────────────────────
  -- SELECT FOR UPDATE serializes concurrent callers; the second one waits
  -- until the first commits/rolls back, then re-reads available_units.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_equipment_id := (v_item->>'equipment_id')::BIGINT;
    v_quantity     := COALESCE((v_item->>'quantity')::INTEGER, 1);

    IF v_equipment_id IS NULL THEN
      RAISE EXCEPTION 'create_reservation_v2: item missing equipment_id (%)', v_item;
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'create_reservation_v2: quantity must be > 0 (got % for equipment %)', v_quantity, v_equipment_id;
    END IF;

    SELECT available_units, name
      INTO v_available, v_equipment_name
      FROM public.equipment
      WHERE id = v_equipment_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_reservation_v2: equipment % not found', v_equipment_id;
    END IF;

    IF v_available < v_quantity THEN
      RAISE EXCEPTION 'create_reservation_v2: not enough units for "%" (id=%) — requested %, available %',
                      v_equipment_name, v_equipment_id, v_quantity, v_available;
    END IF;
  END LOOP;

  -- ── All items validated; decrement availability ───────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_equipment_id := (v_item->>'equipment_id')::BIGINT;
    v_quantity     := COALESCE((v_item->>'quantity')::INTEGER, 1);

    UPDATE public.equipment
      SET available_units = available_units - v_quantity,
          updated_at      = NOW()
      WHERE id = v_equipment_id;
  END LOOP;

  -- ── Create reservation row ────────────────────────────────────────────────
  -- id: use client-provided or generate via epoch-ms (matches existing pattern)
  v_reservation_id := COALESCE(
    (p_reservation->>'id')::BIGINT,
    (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
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
    p_reservation->>'email',
    p_reservation->>'phone',
    p_reservation->>'student_name',
    p_reservation->>'course',
    COALESCE(p_reservation->>'status', 'ממתין'),
    p_reservation->>'loan_type',
    p_reservation->>'project_name',
    NULLIF(p_reservation->>'borrow_date','')::DATE,
    p_reservation->>'borrow_time',
    NULLIF(p_reservation->>'return_date','')::DATE,
    p_reservation->>'return_time',
    COALESCE(NULLIF(p_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
    NULLIF(p_reservation->>'submitted_at','')::TIMESTAMPTZ,
    COALESCE((p_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
    COALESCE((p_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
    p_reservation->>'crew_sound_name',
    p_reservation->>'crew_sound_phone',
    p_reservation->>'crew_photographer_name',
    p_reservation->>'crew_photographer_phone',
    NULLIF(p_reservation->>'studio_booking_id','')::BIGINT,
    NULLIF(p_reservation->>'lesson_id','')::BIGINT,
    p_reservation->>'booking_kind',
    COALESCE((p_reservation->>'lesson_auto')::BOOLEAN, FALSE),
    NULLIF(p_reservation->>'lesson_kit_id','')::BIGINT
  );

  -- ── Create reservation items ──────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.reservation_items (
      reservation_id, equipment_id, name, quantity, unit_id
    ) VALUES (
      v_reservation_id,
      (v_item->>'equipment_id')::BIGINT,
      v_item->>'name',
      COALESCE((v_item->>'quantity')::INTEGER, 1),
      v_item->>'unit_id'
    );
  END LOOP;

  RETURN v_reservation_id;
END;
$$;

-- ─── PERMISSIONS ─────────────────────────────────────────────────────────────
-- Do NOT grant EXECUTE to anon yet. In phase 3 the app will call this via a
-- server-side API endpoint using the service_role key (same pattern as
-- /api/store.js). Keeping the function restricted means no one can invoke it
-- directly from the browser during the parallel-run phase.
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM authenticated;
-- service_role retains EXECUTE by default via SECURITY DEFINER + ownership.

COMMENT ON FUNCTION public.create_reservation_v2(JSONB, JSONB) IS
  'Atomic reservation creation. Locks equipment rows with FOR UPDATE, validates availability, decrements units, inserts reservation + items. All-or-nothing — any failure rolls back the whole transaction. Called only via service_role from server-side API. See migration 002.';
