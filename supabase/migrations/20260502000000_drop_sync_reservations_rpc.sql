-- Cleanup: drop dead RPC sync_reservations_from_json and refresh comment on
-- the active sync_equipment_from_json. Both functions used to back the
-- "store" JSONB blob mirror; the blob (public.store) was retired on
-- 2026-04-30. sync_reservations_from_json has no callers in src/ or api/
-- anymore (verified 2026-05-02). sync_equipment_from_json is still the
-- primary write path for equipment via /api/sync-equipment.

DROP FUNCTION IF EXISTS public.sync_reservations_from_json(JSONB);

COMMENT ON FUNCTION public.sync_equipment_from_json(JSONB) IS
  'Primary equipment write path. Accepts full equipment array from /api/sync-equipment, upserts into equipment + equipment_units, deletes rows not present. Single source of truth — no longer a mirror (public.store dropped 2026-04-30).';
