-- ============================================================================
-- Migration 012: Atomic single-reservation delete RPC
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Fix the "reservation jumps back for a few seconds after clicking the
--   trash button" flicker that users have been seeing in ReservationsPage.
--
-- THE BUG:
--   deleteReservation in ReservationsPage.jsx does an optimistic setState
--   then a fire-and-forget storageSet('reservations', list without row). The
--   storageSet pipeline is:
--     1) await fetch /api/store with key='backup_reservations' (up to 6s)
--     2) lsSet(key, value)              // cache updated
--     3) await fetch /api/store         // real write (up to 8s)
--     4) mirrorReservationsIfNeeded()   // syncs to reservations_new
--
--   So for 2–14 seconds, localStorage and reservations_new both still show
--   the row. If the 3-minute admin poll or the Supabase realtime listener
--   happens to fire during that window, they fetch the stale state and call
--   setReservations(with the deleted row still present) — the card flickers
--   back onto the screen and disappears again a moment later.
--
-- THIS RPC (delete_reservation_v1):
--   1) Looks up the row in reservations_new, notes which equipment it touches.
--   2) DELETE FROM reservation_items.
--   3) DELETE FROM reservations_new.
--   4) Updates store.reservations JSONB blob — strips the row by id.
--   5) Recomputes available_units for touched equipment (same formula as
--      migration 005/008, so the cached counter stays aligned with the mirror).
--
--   All 5 steps run in one transaction. A concurrent poll/listener fires AFTER
--   the commit, so it sees the consistent post-delete state. No flicker.
--
-- PROTOCOL:
--   RPC: delete_reservation_v1(p_reservation_id TEXT)
--   Returns JSONB: { ok, id, deleted_rows, recomputed_equipment, source }
--     source = 'normalized' when the row was in reservations_new
--     source = 'json_only'  when the row existed only in the JSON blob
--                            (shouldn't happen after Stage 2a, but be robust)
--     source = 'not_found'  when the id matches nothing (treated as success
--                            to keep client idempotent on retries).
--
-- SHRINK-GUARD INTERACTION:
--   The guard (migration 011) blocks UPDATEs on store.reservations that
--   shrink by >10% + >1 row. This RPC shrinks by exactly 1 row so it is
--   never blocked. No bypass is required.
--
-- SAFETY:
--   * CREATE OR REPLACE — re-runnable.
--   * Scope: deletes exactly ONE row by primary key. Cannot accidentally
--     match multiple rows.
--   * All writes are in one txn, so a mid-way failure rolls everything back.
--
-- VERIFICATION:
--   -- Pick a reservation to delete
--   SELECT id, student_name FROM reservations_new
--   WHERE status = 'נדחה' LIMIT 1;
--   -- Run the RPC
--   SELECT delete_reservation_v1('<that id>');
--   -- Check:
--   --  * row is gone from reservations_new & reservation_items
--   --  * row is gone from store.reservations JSON
--   --  * available_units for the equipment it held reflects the freed units
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_reservation_v1(p_reservation_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_equipment_ids TEXT[];
  v_normalized_deleted INT := 0;
  v_items_deleted      INT := 0;
  v_json_before_len    INT;
  v_json_after_len     INT;
  v_source             TEXT;
  v_recomputed         INT := 0;
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
  END IF;

  -- 1. Gather equipment_ids before deleting items (need them for the recompute)
  SELECT ARRAY_AGG(DISTINCT equipment_id::TEXT)
    INTO v_equipment_ids
  FROM public.reservation_items
  WHERE reservation_id = p_reservation_id;

  -- 2. Delete child rows first (FK), then the reservation itself
  WITH d_items AS (
    DELETE FROM public.reservation_items
    WHERE reservation_id = p_reservation_id
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_items_deleted FROM d_items;

  WITH d_res AS (
    DELETE FROM public.reservations_new
    WHERE id = p_reservation_id
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_normalized_deleted FROM d_res;

  -- 3. Update the JSONB mirror (store.reservations) — strip the row by id.
  --    Even when the row was never in reservations_new (e.g. a transient
  --    JSON-only cache created before Stage 2a), this cleans it up.
  SELECT jsonb_array_length(data) INTO v_json_before_len
  FROM public.store WHERE key = 'reservations';

  UPDATE public.store
  SET data = COALESCE((
        SELECT jsonb_agg(e)
        FROM jsonb_array_elements(data) e
        WHERE (e->>'id') <> p_reservation_id
      ), '[]'::jsonb),
      updated_at = NOW()
  WHERE key = 'reservations';

  SELECT jsonb_array_length(data) INTO v_json_after_len
  FROM public.store WHERE key = 'reservations';

  -- 4. Decide source (for client diagnostics)
  IF v_normalized_deleted > 0 THEN
    v_source := 'normalized';
  ELSIF v_json_before_len IS NOT NULL AND v_json_after_len < v_json_before_len THEN
    v_source := 'json_only';
  ELSE
    v_source := 'not_found';
  END IF;

  -- 5. Recompute available_units for every equipment_id this reservation
  --    touched. Same formula as migration 008 (and sync_equipment_from_json)
  --    so the cached counter stays aligned with the mirror.
  IF v_equipment_ids IS NOT NULL AND array_length(v_equipment_ids, 1) > 0 THEN
    UPDATE public.equipment eq
    SET available_units = GREATEST(
          (
            SELECT COUNT(*) FROM public.equipment_units u
            WHERE u.equipment_id = eq.id AND u.status = 'תקין'
          )
          - COALESCE((
              SELECT SUM(ri.quantity)
              FROM public.reservation_items ri
              JOIN public.reservations_new r ON r.id = ri.reservation_id
              WHERE ri.equipment_id = eq.id
                AND (
                  r.status IN ('באיחור','פעילה')
                  OR (
                    r.status = 'מאושר'
                    AND r.borrow_date IS NOT NULL
                    AND (r.borrow_date
                         + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                         <= (NOW() AT TIME ZONE 'Asia/Jerusalem')
                  )
                )
            ), 0),
          0
        ),
        updated_at = NOW()
    WHERE eq.id::TEXT = ANY(v_equipment_ids);

    GET DIAGNOSTICS v_recomputed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',                   TRUE,
    'id',                   p_reservation_id,
    'source',               v_source,
    'normalized_deleted',   v_normalized_deleted,
    'items_deleted',        v_items_deleted,
    'json_shrunk_by',       COALESCE(v_json_before_len - v_json_after_len, 0),
    'recomputed_equipment', v_recomputed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_reservation_v1(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_reservation_v1(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.delete_reservation_v1(TEXT) FROM authenticated;

COMMENT ON FUNCTION public.delete_reservation_v1(TEXT) IS
  'Atomically delete a reservation from reservations_new, reservation_items, and the store.reservations JSON mirror, then recompute available_units for touched equipment. Fixes the "trash-button flicker" bug introduced by fire-and-forget storageSet(''reservations'', ...) calls in ReservationsPage/ArchivePage.';
