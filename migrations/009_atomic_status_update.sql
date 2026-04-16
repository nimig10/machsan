-- ============================================================================
-- Migration 009: Atomic reservation status update (admin + lecturer paths)
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Stage 1 of extending the atomic RPC pattern beyond the public form.
--   Every admin/lecturer page currently updates status by the fetch-list →
--   mutate → storageSet("reservations", fullList) pattern. That pattern:
--     * overwrites the whole JSON blob, exposing race conditions with
--       parallel writes from the public form and from other admins;
--     * does not recompute available_units, so approvals that transition
--       into the "currently out" window do not refresh the counter;
--     * does not take a row lock, so two admins clicking "approve" on the
--       same request concurrently can both win, both can email, etc.
--
--   This RPC fixes all three. It:
--     1) locks the reservation row (FOR UPDATE),
--     2) updates status (and optional returned_at),
--     3) recomputes available_units for every equipment_id the reservation
--        touches, using the same formula as sync_equipment_from_json
--        (migration 005) and create_reservation_v2 (migration 008).
--
-- RETURNS:
--   JSONB object with { id, old_status, new_status } so the caller can
--   detect no-op updates and decide whether to send emails, log activity, etc.
--
-- ALLOWED STATUSES:
--   Any of the taxonomy currently in use across the app:
--     'ממתין','אישור ראש מחלקה','מאושר','נדחה','בוטל','מבוטל','הוחזר',
--     'באיחור','פעילה'.
--   Other values are rejected with RAISE EXCEPTION — this keeps junk out
--   of the column.
--
-- CONCURRENCY:
--   FOR UPDATE lock on reservations_new serializes concurrent status changes
--   on the same reservation. Two admins clicking approve at once: one wins,
--   the other reads the already-approved row and RETURNs a no-op.
--
-- SAFETY:
--   * CREATE OR REPLACE — re-runnable, does not touch data.
--   * Does NOT insert or delete reservations. Only updates status +
--     returned_at and refreshes cached counters.
--   * Counter recompute uses GREATEST(..., 0) so the value can never
--     go negative.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_reservation_status_v1(
  p_reservation_id TEXT,
  p_new_status     TEXT,
  p_returned_at    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status     TEXT;
  v_equipment_ids  TEXT[];
  v_allowed        TEXT[] := ARRAY[
    'ממתין',
    'אישור ראש מחלקה',
    'מאושר',
    'נדחה',
    'בוטל',
    'מבוטל',
    'הוחזר',
    'באיחור',
    'פעילה'
  ];
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RAISE EXCEPTION 'update_reservation_status_v1: p_reservation_id is required';
  END IF;
  IF p_new_status IS NULL OR NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'update_reservation_status_v1: invalid status "%"', p_new_status;
  END IF;

  -- Lock the reservation row. Serializes two admins both trying to change
  -- the same request: second caller waits, then sees the updated status.
  SELECT status INTO v_old_status
    FROM public.reservations_new
    WHERE id = p_reservation_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_reservation_status_v1: reservation % not found', p_reservation_id;
  END IF;

  -- Collect equipment_ids referenced by this reservation, so we can
  -- recompute their available_units counters after the status change.
  SELECT array_agg(DISTINCT equipment_id) INTO v_equipment_ids
    FROM public.reservation_items
    WHERE reservation_id = p_reservation_id;

  -- Update the reservation row. Only touches status + returned_at +
  -- updated_at, everything else is preserved exactly as-is.
  UPDATE public.reservations_new
    SET status      = p_new_status,
        returned_at = CASE
                        WHEN p_new_status = 'הוחזר' THEN COALESCE(p_returned_at, NOW())
                        ELSE COALESCE(p_returned_at, returned_at)
                      END,
        updated_at  = NOW()
    WHERE id = p_reservation_id;

  -- ── RECOMPUTE available_units for the touched equipment rows ───────────
  -- Same formula as sync_equipment_from_json (migration 005) and
  -- create_reservation_v2 (migration 008). Keeps the cached counter
  -- aligned with the mirror's semantic — only "currently out of
  -- warehouse" reservations count.
  IF v_equipment_ids IS NOT NULL AND array_length(v_equipment_ids, 1) > 0 THEN
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
  END IF;

  RETURN jsonb_build_object(
    'id',         p_reservation_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'changed',    (v_old_status IS DISTINCT FROM p_new_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_status_v1(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_reservation_status_v1(TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.update_reservation_status_v1(TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;

COMMENT ON FUNCTION public.update_reservation_status_v1(TEXT, TEXT, TIMESTAMPTZ) IS
  'Atomic reservation status change. v1 (migration 009, 2026-04-16): row-locks the reservation, updates status (+ returned_at when transitioning to הוחזר), and recomputes available_units for every equipment_id the reservation references. Replaces admin-page fetch-list → mutate → storageSet pattern. Called via /api/update-reservation-status.';


-- ─── VERIFY (optional, run after commit) ────────────────────────────────────
-- 1. Confirm the function was created:
--    SELECT proname, pg_get_function_arguments(oid) AS args
--    FROM pg_proc
--    WHERE proname = 'update_reservation_status_v1';
--
-- 2. Dry-run on a test reservation:
--    SELECT public.update_reservation_status_v1('<some_id>', 'ממתין');
--    -- Expect JSONB: { "id": "...", "old_status": "...", "new_status": "ממתין", "changed": true/false }
--
-- 3. Confirm rejection of an invalid status:
--    SELECT public.update_reservation_status_v1('<some_id>', 'BOGUS');
--    -- Expect EXCEPTION: 'invalid status "BOGUS"'
