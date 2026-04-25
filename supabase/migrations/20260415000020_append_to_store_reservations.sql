-- 021_append_to_store_reservations.sql
-- Applied: 2026-04-17
--
-- Atomic append for store.reservations JSON blob. Fixes the shrink_guard
-- false-positive path where the public form (PublicForm.jsx), after the
-- atomic create-reservation RPC, tried to POST the full reservations list
-- back through /api/store to keep the blob in sync. When the client cache
-- was stale by >10% (e.g. other students submitted between page load and
-- this submit), the shrink_guard trigger refused the write and the student
-- saw a failure even though their reservation already existed.
--
-- This function appends a single reservation object to store.reservations
-- under a server-side UPDATE, so no full-list round-trip is involved and
-- shrink_guard never fires (only growth, no shrink).

CREATE OR REPLACE FUNCTION public.append_to_store_reservations(p_reservation jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.store
  SET data = COALESCE(data, '[]'::jsonb) || jsonb_build_array(p_reservation),
      updated_at = NOW()
  WHERE key = 'reservations';
$$;

REVOKE ALL ON FUNCTION public.append_to_store_reservations(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_to_store_reservations(jsonb) TO service_role;
