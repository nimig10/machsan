-- ============================================================================
-- Migration 024: Retire equipment + reservations from store blob
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Stage 5 of the normalization migration is complete. Equipment and
--   reservations now write exclusively to their normalized Supabase tables
--   (equipment, equipment_units, reservations_new, reservation_items).
--   The store table rows for 'equipment' and 'reservations' are no longer
--   read or written by the application.
--
--   This migration:
--   A) Removes 'equipment' and 'reservations' from the shrink_guard protected
--      keys list — the guard is no longer needed for these two keys since
--      the app never writes blob arrays for them anymore.
--   B) Archives (then deletes) the stale 'equipment' and 'reservations' rows
--      from store — kept in store_snapshots for forensic purposes before
--      deletion.
--
-- SAFETY:
--   * Run AFTER verifying the app has been stable for 1+ week writing only
--     to normalized tables (confirm via Vercel logs: no 401/500 on
--     /api/sync-equipment, no writes to store for these keys).
--   * store_snapshots already captures a history of the last writes.
--   * The store rows for ALL OTHER keys (kits, categories, teamMembers, etc.)
--     are untouched.
--   * sync_equipment_from_json RPC and /api/sync-equipment endpoint are
--     RETAINED — writeEquipmentToDB() still calls them.
--   * sync_reservations_from_json RPC is RETAINED for potential future use
--     or rollback, but the /api/sync-reservations.js endpoint was removed
--     from the codebase (no callers remain).
-- ============================================================================

BEGIN;

-- ── A. Remove 'equipment' and 'reservations' from the protected-keys list ───
-- We replace the is_protected_store_key function with one that excludes them.

CREATE OR REPLACE FUNCTION is_protected_store_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
  SELECT p_key = ANY(ARRAY[
    'kits',
    'studios','studio_bookings','studioBookings',
    'lessons','lecturers','teamMembers','categories','students'
    -- 'equipment' and 'reservations' removed (Stage 5 — normalized tables only)
  ]);
$$;

-- ── B. Archive stale store rows into store_snapshots before deletion ─────────
-- This ensures forensic history is preserved even after the rows are gone.

INSERT INTO store_snapshots (key, data, prev_len, new_len, blocked, note)
SELECT
  key,
  data,
  CASE WHEN jsonb_typeof(data) = 'array' THEN jsonb_array_length(data) ELSE NULL END,
  0,
  FALSE,
  'archived_stage5_retire — row deleted from store, data lives here for forensics'
FROM store
WHERE key IN ('equipment', 'reservations')
  AND data IS NOT NULL;

-- ── C. Delete the stale rows from store ──────────────────────────────────────
-- Safe: the app no longer reads or writes these keys via the blob path.

SET app.allow_store_bulk_shrink = 'on';

DELETE FROM store WHERE key IN ('equipment', 'reservations');

COMMIT;

-- ============================================================================
-- Verification queries (run manually after apply):
--
--   -- 1. Confirm rows are gone from store
--   SELECT key, updated_at FROM store WHERE key IN ('equipment','reservations');
--   -- Expected: 0 rows
--
--   -- 2. Confirm archive snapshot exists
--   SELECT key, prev_len, note, taken_at
--   FROM store_snapshots
--   WHERE note LIKE 'archived_stage5%'
--   ORDER BY taken_at DESC;
--   -- Expected: 2 rows (equipment + reservations)
--
--   -- 3. Confirm shrink_guard no longer protects equipment/reservations
--   SELECT is_protected_store_key('equipment');   -- should return FALSE
--   SELECT is_protected_store_key('reservations'); -- should return FALSE
--   SELECT is_protected_store_key('kits');         -- should return TRUE
--
--   -- 4. Confirm normalized tables still have data
--   SELECT COUNT(*) FROM equipment;        -- should match old equipment count
--   SELECT COUNT(*) FROM reservations_new; -- should match old reservations count
-- ============================================================================
