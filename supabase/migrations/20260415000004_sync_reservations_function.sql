-- ============================================================================
-- Migration 004: sync_reservations_from_json — mirror full reservations array
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Dual-write mirror. When the app calls storageSet('reservations', array),
--   the same array is also sent here, which UPSERTs it into reservations_new
--   + reservation_items, and prunes rows no longer in the array.
--
-- WHY NOT USE create_reservation_v2 PER RESERVATION:
--   create_reservation_v2 is for atomic single-reservation creation with
--   availability check. This function is for mirroring already-created
--   state — no availability decrement here, just state sync.
--
-- SAFETY:
--   * Only operates on new tables (reservations_new, reservation_items).
--   * Does NOT touch `store`.
--   * Pure CREATE FUNCTION. Safe to re-run.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-15
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
  DELETE FROM public.reservations_new
    WHERE NOT (id = ANY(v_ids_kept));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'deleted',  v_deleted,
    'total_in', jsonb_array_length(p_reservations)
  );
END $$;

REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.sync_reservations_from_json(JSONB) FROM authenticated;

COMMENT ON FUNCTION public.sync_reservations_from_json(JSONB) IS
  'State-based dual-write mirror. Accepts full reservations array, upserts into reservations_new + reservation_items, deletes rows not present. Called by /api/sync-reservations (service_role) on every storageSet(reservations). See migration 004.';
