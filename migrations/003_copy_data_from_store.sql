-- ============================================================================
-- Migration 003: Copy existing data from store JSON blobs into new tables
-- ----------------------------------------------------------------------------
-- SAFETY:
--   * Pure INSERT from store. Does NOT touch, update, or delete store rows.
--   * Uses ON CONFLICT DO NOTHING — safe to re-run.
--   * If something goes wrong, truncate new tables and re-run. The source
--     (store table) is never modified.
--   * Expected scale: 119 equipment items, ~256 units, 38 reservations.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-15
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

-- ─── 0. SCHEMA FIXES before data copy ─────────────────────────────────────
-- All tables are still empty, so these ALTERs are safe.
--
-- (a) certification_id is stored as text (e.g. "cert_1773...")
ALTER TABLE public.equipment ALTER COLUMN certification_id TYPE TEXT USING certification_id::TEXT;
--
-- (b) Legacy JS-generated IDs can be integer, decimal, OR string (e.g.
--     "lesson_res_lesson_1776080980078_0"). TEXT accommodates all three.
--     Must drop FK constraints, alter types, then re-add FKs.

ALTER TABLE public.equipment_units   DROP CONSTRAINT IF EXISTS equipment_units_equipment_id_fkey;
ALTER TABLE public.reservation_items DROP CONSTRAINT IF EXISTS reservation_items_reservation_id_fkey;
ALTER TABLE public.reservation_items DROP CONSTRAINT IF EXISTS reservation_items_equipment_id_fkey;

ALTER TABLE public.equipment         ALTER COLUMN id                TYPE TEXT USING id::TEXT;
ALTER TABLE public.equipment_units   ALTER COLUMN equipment_id      TYPE TEXT USING equipment_id::TEXT;
ALTER TABLE public.reservations_new  ALTER COLUMN id                TYPE TEXT USING id::TEXT;
ALTER TABLE public.reservations_new  ALTER COLUMN studio_booking_id TYPE TEXT USING studio_booking_id::TEXT;
ALTER TABLE public.reservations_new  ALTER COLUMN lesson_id         TYPE TEXT USING lesson_id::TEXT;
ALTER TABLE public.reservations_new  ALTER COLUMN lesson_kit_id     TYPE TEXT USING lesson_kit_id::TEXT;
ALTER TABLE public.reservation_items ALTER COLUMN reservation_id    TYPE TEXT USING reservation_id::TEXT;
ALTER TABLE public.reservation_items ALTER COLUMN equipment_id      TYPE TEXT USING equipment_id::TEXT;

ALTER TABLE public.equipment_units
  ADD CONSTRAINT equipment_units_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;
ALTER TABLE public.reservation_items
  ADD CONSTRAINT reservation_items_reservation_id_fkey
  FOREIGN KEY (reservation_id) REFERENCES public.reservations_new(id) ON DELETE CASCADE;
ALTER TABLE public.reservation_items
  ADD CONSTRAINT reservation_items_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE SET NULL;
--
-- (c) Recreate the RPC with NUMERIC ids (migration 002 used BIGINT).
DROP FUNCTION IF EXISTS public.create_reservation_v2(JSONB, JSONB);

-- Helper: parse either ISO-8601 or Hebrew "dd.mm.yyyy, HH:MM" format, else NULL
CREATE OR REPLACE FUNCTION public._migr_parse_ts(s TEXT) RETURNS TIMESTAMPTZ AS $$
BEGIN
  IF s IS NULL OR s = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN s::TIMESTAMPTZ;                                    -- try ISO first
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      RETURN to_timestamp(s, 'DD.MM.YYYY, HH24:MI');          -- Hebrew format
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
END $$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: parse date, either ISO or dd.mm.yyyy, else NULL
CREATE OR REPLACE FUNCTION public._migr_parse_date(s TEXT) RETURNS DATE AS $$
BEGIN
  IF s IS NULL OR s = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN s::DATE;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      RETURN to_date(s, 'DD.MM.YYYY');
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
END $$ LANGUAGE plpgsql IMMUTABLE;

BEGIN;

-- ─── 1. EQUIPMENT (row per item) ────────────────────────────────────────────
INSERT INTO public.equipment (
  id, name, category, image, notes, description, technical_details, status,
  photo_only, sound_only, private_loan_unlimited, certification_id,
  total_quantity, available_units, created_at, updated_at
)
SELECT
  (item->>'id')::TEXT,
  COALESCE(item->>'name', ''),
  item->>'category',
  item->>'image',
  COALESCE(item->>'notes', ''),
  COALESCE(item->>'description', ''),
  COALESCE(item->>'technical_details', ''),
  COALESCE(item->>'status', 'תקין'),
  COALESCE((item->>'photoOnly')::BOOLEAN, FALSE),
  COALESCE((item->>'soundOnly')::BOOLEAN, FALSE),
  COALESCE((item->>'privateLoanUnlimited')::BOOLEAN, FALSE),
  NULLIF(item->>'certification_id',''),
  COALESCE((item->>'total_quantity')::INTEGER, jsonb_array_length(COALESCE(item->'units','[]'::jsonb))),
  COALESCE((item->>'total_quantity')::INTEGER, jsonb_array_length(COALESCE(item->'units','[]'::jsonb))),  -- placeholder; recomputed below
  NOW(),
  NOW()
FROM public.store,
     jsonb_array_elements(data) AS item
WHERE key = 'equipment'
  AND item->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ─── 2. EQUIPMENT_UNITS (row per physical unit) ─────────────────────────────
INSERT INTO public.equipment_units (
  id, equipment_id, status, fault, repair, created_at, updated_at
)
SELECT
  unit->>'id',
  (item->>'id')::TEXT,
  COALESCE(unit->>'status', 'תקין'),
  COALESCE(unit->>'fault', ''),
  COALESCE(unit->>'repair', ''),
  NOW(),
  NOW()
FROM public.store,
     jsonb_array_elements(data) AS item,
     jsonb_array_elements(item->'units') AS unit
WHERE key = 'equipment'
  AND unit->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ─── 3. RESERVATIONS_NEW (row per reservation) ──────────────────────────────
INSERT INTO public.reservations_new (
  id, email, phone, student_name, course, status, loan_type, project_name,
  borrow_date, borrow_time, return_date, return_time,
  created_at, submitted_at, returned_at,
  overdue_email_sent, overdue_notified,
  sound_day_loan, sound_night_loan,
  crew_sound_name, crew_sound_phone,
  crew_photographer_name, crew_photographer_phone,
  studio_booking_id, lesson_id, booking_kind, lesson_auto, lesson_kit_id,
  updated_at
)
SELECT
  (r->>'id')::TEXT,
  r->>'email',
  r->>'phone',
  r->>'student_name',
  r->>'course',
  COALESCE(r->>'status', 'מאושר'),
  r->>'loan_type',
  r->>'project_name',
  public._migr_parse_date(r->>'borrow_date'),
  r->>'borrow_time',
  public._migr_parse_date(r->>'return_date'),
  r->>'return_time',
  COALESCE(public._migr_parse_ts(r->>'created_at'), NOW()),
  public._migr_parse_ts(r->>'submitted_at'),
  public._migr_parse_ts(r->>'returned_at'),
  COALESCE((r->>'overdue_email_sent')::BOOLEAN, FALSE),
  COALESCE((r->>'overdue_notified')::BOOLEAN, FALSE),
  COALESCE((r->>'sound_day_loan')::BOOLEAN, FALSE),
  COALESCE((r->>'sound_night_loan')::BOOLEAN, FALSE),
  r->>'crew_sound_name',
  r->>'crew_sound_phone',
  r->>'crew_photographer_name',
  r->>'crew_photographer_phone',
  NULLIF(r->>'studio_booking_id','')::TEXT,
  NULLIF(r->>'lesson_id','')::TEXT,
  r->>'bookingKind',
  COALESCE((r->>'lesson_auto')::BOOLEAN, FALSE),
  NULLIF(r->>'lesson_kit_id','')::TEXT,
  NOW()
FROM public.store,
     jsonb_array_elements(data) AS r
WHERE key = 'reservations'
  AND r->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ─── 4. RESERVATION_ITEMS (row per item in each reservation) ────────────────
-- If the referenced equipment no longer exists (deleted), set equipment_id
-- to NULL but preserve the item (name is still informative for history).
INSERT INTO public.reservation_items (
  reservation_id, equipment_id, name, quantity, created_at
)
SELECT
  r->>'id',
  CASE
    WHEN e.id IS NOT NULL THEN NULLIF(item->>'equipment_id','')
    ELSE NULL
  END,
  item->>'name',
  COALESCE((item->>'quantity')::INTEGER, 1),
  NOW()
FROM public.store s,
     jsonb_array_elements(s.data) AS r,
     jsonb_array_elements(r->'items') AS item
     LEFT JOIN public.equipment e ON e.id = NULLIF(item->>'equipment_id','')
WHERE s.key = 'reservations'
  AND r->>'id' IS NOT NULL
  AND item->>'equipment_id' IS NOT NULL;
-- Note: no ON CONFLICT — reservation_items has BIGSERIAL pk, re-running would
-- create duplicates. If you need to re-run, TRUNCATE reservation_items first.

-- ─── 5. RECOMPUTE available_units ───────────────────────────────────────────
-- available_units = (healthy units) - (open reservation quantities)
-- Healthy unit statuses: 'תקין'
-- Open reservation statuses: NOT IN ('הוחזר', 'בוטל', 'מבוטל')

WITH healthy AS (
  SELECT equipment_id, COUNT(*) AS healthy_count
  FROM public.equipment_units
  WHERE status = 'תקין'
  GROUP BY equipment_id
),
open_qty AS (
  SELECT ri.equipment_id, SUM(ri.quantity) AS reserved_count
  FROM public.reservation_items ri
  JOIN public.reservations_new r ON r.id = ri.reservation_id
  WHERE r.status NOT IN ('הוחזר', 'בוטל', 'מבוטל')
  GROUP BY ri.equipment_id
)
UPDATE public.equipment e
SET available_units = GREATEST(
      COALESCE((SELECT healthy_count FROM healthy WHERE equipment_id = e.id), e.total_quantity)
      - COALESCE((SELECT reserved_count FROM open_qty WHERE equipment_id = e.id), 0),
      0
    ),
    updated_at = NOW();

COMMIT;

-- ─── 6. RECREATE RPC with NUMERIC ids ───────────────────────────────────────
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
  v_available      INTEGER;
  v_equipment_name TEXT;
BEGIN
  IF p_reservation IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: p_reservation and p_items are required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_reservation_v2: p_items must contain at least one item';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_equipment_id := (v_item->>'equipment_id')::TEXT;
    v_quantity     := COALESCE((v_item->>'quantity')::INTEGER, 1);
    IF v_equipment_id IS NULL THEN
      RAISE EXCEPTION 'create_reservation_v2: item missing equipment_id (%)', v_item;
    END IF;
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'create_reservation_v2: quantity must be > 0';
    END IF;
    SELECT available_units, name INTO v_available, v_equipment_name
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_reservation_v2: equipment % not found', v_equipment_id;
    END IF;
    IF v_available < v_quantity THEN
      RAISE EXCEPTION 'create_reservation_v2: not enough units for "%" (id=%) — requested %, available %',
                      v_equipment_name, v_equipment_id, v_quantity, v_available;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_equipment_id := (v_item->>'equipment_id')::TEXT;
    v_quantity     := COALESCE((v_item->>'quantity')::INTEGER, 1);
    UPDATE public.equipment
      SET available_units = available_units - v_quantity, updated_at = NOW()
      WHERE id = v_equipment_id;
  END LOOP;

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
    NULLIF(p_reservation->>'borrow_date','')::DATE, p_reservation->>'borrow_time',
    NULLIF(p_reservation->>'return_date','')::DATE, p_reservation->>'return_time',
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

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.create_reservation_v2(JSONB, JSONB) FROM authenticated;

-- ─── CLEANUP: drop migration helpers ────────────────────────────────────────
DROP FUNCTION IF EXISTS public._migr_parse_ts(TEXT);
DROP FUNCTION IF EXISTS public._migr_parse_date(TEXT);

-- ─── 7. VERIFY (run these after commit) ─────────────────────────────────────
-- SELECT COUNT(*) AS equipment_count FROM public.equipment;            -- expect 119
-- SELECT COUNT(*) AS units_count     FROM public.equipment_units;      -- expect ~256
-- SELECT COUNT(*) AS reservations    FROM public.reservations_new;     -- expect 38
-- SELECT COUNT(*) AS items_count     FROM public.reservation_items;    -- expect ≥ 38
-- SELECT SUM(total_quantity), SUM(available_units) FROM public.equipment;
