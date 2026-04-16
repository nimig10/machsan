-- ============================================================================
-- Migration 007: Grace period for sync_reservations_from_json prune
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Prepare the mirror to coexist safely with the atomic RPC
--   create_reservation_v2, which writes directly to reservations_new.
--
-- THE RACE WE ARE FIXING:
--   1. User X submits → /api/create-reservation → RPC atomically inserts C
--      into reservations_new. (New tables = [A, B, C])
--   2. User X then calls storageSet("reservations", [...stale, C]) to keep
--      the JSON blob in sync. This fires the mirror.
--   3. Meanwhile user Y submitted in parallel → RPC inserted D.
--      (New tables = [A, B, C, D])
--   4. User X's mirror call runs with blob [A, B, C] (X read store BEFORE
--      D existed). The old prune logic would DELETE D from reservations_new.
--   → D disappears from the authoritative tables. Data loss.
--
-- THE FIX:
--   Only prune rows older than 60 seconds. Any row created in the last minute
--   is assumed to be the product of a concurrent atomic RPC insert and is
--   protected from the mirror's delete pass. Legitimate admin deletes will
--   propagate on the next storageSet after 60s, which is acceptable latency.
--
-- WHY 60 SECONDS:
--   Generous upper bound on the storageSet fetch→modify→write window. In
--   practice the window is milliseconds; 60s gives comfortable safety margin
--   without noticeably delaying legitimate deletes.
--
-- WHY NOT DROP PRUNE ENTIRELY:
--   Admins do occasionally hard-delete reservations. Until stage 4 switches
--   reads to new tables, store.reservations is still the source of truth
--   for the UI, so deletes must propagate somehow.
--
-- SAFETY:
--   Pure CREATE OR REPLACE of the existing function. No schema changes.
--   Safe to re-run.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_reservations_from_json(p_reservations JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids_kept    TEXT[];
  v_deleted     INTEGER;
  v_upserted    INTEGER := 0;
  -- Grace window — rows newer than this are shielded from the prune pass.
  v_grace       INTERVAL := INTERVAL '60 seconds';
BEGIN
  IF p_reservations IS NULL OR jsonb_typeof(p_reservations) <> 'array' THEN
    RAISE EXCEPTION 'sync_reservations_from_json: p_reservations must be a JSON array';
  END IF;

  -- Collect all ids present in the input array
  SELECT COALESCE(array_agg(r->>'id'), ARRAY[]::TEXT[])
    INTO v_ids_kept
  FROM jsonb_array_elements(p_reservations) AS r
  WHERE r->>'id' IS NOT NULL;

  -- ── UPSERT each reservation ──────────────────────────────────────────────
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
    r->>'id',
    r->>'email', r->>'phone', r->>'student_name', r->>'course',
    COALESCE(r->>'status','מאושר'), r->>'loan_type', r->>'project_name',
    NULLIF(r->>'borrow_date','')::DATE, r->>'borrow_time',
    NULLIF(r->>'return_date','')::DATE, r->>'return_time',
    COALESCE(
      CASE WHEN r->>'created_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (r->>'created_at')::TIMESTAMPTZ END,
      NOW()
    ),
    CASE WHEN r->>'submitted_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (r->>'submitted_at')::TIMESTAMPTZ END,
    CASE WHEN r->>'returned_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (r->>'returned_at')::TIMESTAMPTZ END,
    COALESCE((r->>'overdue_email_sent')::BOOLEAN, FALSE),
    COALESCE((r->>'overdue_notified')::BOOLEAN, FALSE),
    COALESCE((r->>'sound_day_loan')::BOOLEAN, FALSE),
    COALESCE((r->>'sound_night_loan')::BOOLEAN, FALSE),
    r->>'crew_sound_name', r->>'crew_sound_phone',
    r->>'crew_photographer_name', r->>'crew_photographer_phone',
    NULLIF(r->>'studio_booking_id',''),
    NULLIF(r->>'lesson_id',''),
    r->>'bookingKind',
    COALESCE((r->>'lesson_auto')::BOOLEAN, FALSE),
    NULLIF(r->>'lesson_kit_id',''),
    NOW()
  FROM jsonb_array_elements(p_reservations) AS r
  WHERE r->>'id' IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    email                   = EXCLUDED.email,
    phone                   = EXCLUDED.phone,
    student_name            = EXCLUDED.student_name,
    course                  = EXCLUDED.course,
    status                  = EXCLUDED.status,
    loan_type               = EXCLUDED.loan_type,
    project_name            = EXCLUDED.project_name,
    borrow_date             = EXCLUDED.borrow_date,
    borrow_time             = EXCLUDED.borrow_time,
    return_date             = EXCLUDED.return_date,
    return_time             = EXCLUDED.return_time,
    submitted_at            = EXCLUDED.submitted_at,
    returned_at             = EXCLUDED.returned_at,
    overdue_email_sent      = EXCLUDED.overdue_email_sent,
    overdue_notified        = EXCLUDED.overdue_notified,
    sound_day_loan          = EXCLUDED.sound_day_loan,
    sound_night_loan        = EXCLUDED.sound_night_loan,
    crew_sound_name         = EXCLUDED.crew_sound_name,
    crew_sound_phone        = EXCLUDED.crew_sound_phone,
    crew_photographer_name  = EXCLUDED.crew_photographer_name,
    crew_photographer_phone = EXCLUDED.crew_photographer_phone,
    studio_booking_id       = EXCLUDED.studio_booking_id,
    lesson_id               = EXCLUDED.lesson_id,
    booking_kind            = EXCLUDED.booking_kind,
    lesson_auto             = EXCLUDED.lesson_auto,
    lesson_kit_id           = EXCLUDED.lesson_kit_id,
    updated_at              = NOW();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- ── Replace items for each reservation (delete all, re-insert) ───────────
  DELETE FROM public.reservation_items
    WHERE reservation_id = ANY(v_ids_kept);

  INSERT INTO public.reservation_items (
    reservation_id, equipment_id, name, quantity
  )
  SELECT
    r->>'id',
    CASE
      WHEN e.id IS NOT NULL THEN NULLIF(item->>'equipment_id','')
      ELSE NULL
    END,
    item->>'name',
    COALESCE((item->>'quantity')::INTEGER, 1)
  FROM jsonb_array_elements(p_reservations) AS r,
       jsonb_array_elements(r->'items') AS item
       LEFT JOIN public.equipment e ON e.id = NULLIF(item->>'equipment_id','')
  WHERE r->>'id' IS NOT NULL
    AND item->>'equipment_id' IS NOT NULL;

  -- ── Remove reservations that no longer exist in the source array ─────────
  -- Grace period: skip rows created in the last 60 seconds. They are likely
  -- the product of a concurrent create_reservation_v2 call and may not yet
  -- have propagated to the caller's blob.
  DELETE FROM public.reservations_new
    WHERE NOT (id = ANY(v_ids_kept))
      AND created_at < (NOW() - v_grace);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'upserted',      v_upserted,
    'deleted',       v_deleted,
    'total_in',      jsonb_array_length(p_reservations),
    'grace_seconds', EXTRACT(EPOCH FROM v_grace)
  );
END $$;

REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM authenticated;

COMMENT ON FUNCTION public.sync_reservations_from_json(JSONB) IS
  'State-based dual-write mirror. Accepts full reservations array, upserts into reservations_new + reservation_items, and prunes rows not present — but ONLY rows older than 60 seconds to protect concurrent atomic RPC inserts. See migration 007.';
