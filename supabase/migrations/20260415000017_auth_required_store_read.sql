-- 018_auth_required_store_read.sql
-- Applied: 2026-04-17
--
-- STEP 1 of the anon-read lockdown. Adds an authenticated SELECT policy on
-- public.store so logged-in users (staff + students) can read via their JWT
-- instead of the anon key. This is additive — anon_select_all stays until
-- migration 019 removes it.
--
-- Paired with a frontend change in utils.js / App.jsx that attaches the
-- user's session JWT to direct REST reads (getSbAuthHeaders).

CREATE POLICY "authenticated_select_all" ON public.store
  FOR SELECT TO authenticated
  USING (true);
