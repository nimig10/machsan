-- 20260515100000_restrict_site_settings_manager_token
--
-- Phase 1.4 of the auth UX upgrade: stop exposing site_settings.managerToken
-- to anon callers. The token grants permanent access to /manager-calendar
-- (used in dept-head approval emails), so a public.site_settings SELECT with
-- the anon key currently leaks it to anyone who guesses the table name.
--
-- Approach: drop the blanket anon_read_site_settings policy and replace it
-- with a row-filtered version that excludes the managerToken row. Staff still
-- read it via the existing staff_all_site_settings policy.

DROP POLICY IF EXISTS "anon_read_site_settings" ON public.site_settings;

CREATE POLICY "anon_read_public_site_settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (key <> 'managerToken');
