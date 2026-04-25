-- 020_restore_anon_store_read.sql
-- Applied: 2026-04-17
--
-- Rollback of the anon-SELECT removal from migration 019 on public.store.
-- Students/lecturers could not log in because the public form loads store
-- data BEFORE the login flow completes — without anon SELECT, storageGet
-- returned empty, triggering cascading shrink_guard failures and wiping
-- cached certifications so the "user not found" fallback path fired.
--
-- The other 019 changes stay in place:
--   * reservations_new / reservation_items — anon SELECT still removed
--     (frontend reads reservations from the store JSON blob, never from
--     these tables).
--   * store_snapshots — RLS still enabled.
--   * store anon INSERT/UPDATE — still removed (atomic RPCs handle writes).
--
-- A proper re-lockdown will split sensitive keys (certifications,
-- team_members, reservations) out of public.store into normalized tables
-- with authenticated-only RLS.

CREATE POLICY "anon_select_all" ON public.store
  FOR SELECT TO anon
  USING (true);
