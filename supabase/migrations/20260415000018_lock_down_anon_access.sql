-- 019_lock_down_anon_access.sql
-- Applied: 2026-04-17
--
-- STEP 2 of the anon-read lockdown. Removes anonymous (public internet)
-- access to sensitive data:
--
--   * store — drop anon SELECT/INSERT/UPDATE. Only authenticated reads and
--     service_role writes remain. Direct writes from students go through
--     /api/create-reservation (service_role, atomic RPC).
--
--   * reservations_new / reservation_items — drop public SELECT. Only
--     service_role reads these now. The frontend reads reservations from
--     the store JSON blob, never directly from these tables.
--
--   * store_snapshots — RLS was disabled entirely. Enable it with no
--     policies, so only service_role (BYPASS RLS) can access. The table
--     holds historical snapshots of reservations/equipment blobs and
--     should never be readable by clients.

DROP POLICY "anon_select_all"           ON public.store;
DROP POLICY "anon_write_student_keys"   ON public.store;
DROP POLICY "anon_update_student_keys"  ON public.store;

DROP POLICY "reservations_new_read_all"  ON public.reservations_new;
DROP POLICY "reservation_items_read_all" ON public.reservation_items;

ALTER TABLE public.store_snapshots ENABLE ROW LEVEL SECURITY;
