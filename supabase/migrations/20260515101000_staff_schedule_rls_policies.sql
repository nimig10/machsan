-- 20260515101000_staff_schedule_rls_policies
--
-- Phase 1.5 of the auth UX upgrade: add the standard 3-policy RLS set to
-- staff_schedule_preferences and staff_schedule_assignments. Both tables
-- have RLS enabled in the bootstrap migration but ZERO policies defined,
-- which means every non-service-role caller silently returns an empty set.
-- The schedule API works today only because api/staff-schedule.js calls
-- Supabase with the service-role key. Without these policies, any future
-- direct client read would mysteriously return nothing.

-- ─── staff_schedule_preferences ──────────────────────────────────────────────
CREATE POLICY "service_role_all_staff_schedule_preferences"
  ON public.staff_schedule_preferences FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_staff_schedule_preferences"
  ON public.staff_schedule_preferences FOR ALL TO authenticated
  USING (public.is_staff_member()) WITH CHECK (public.is_staff_member());

-- ─── staff_schedule_assignments ──────────────────────────────────────────────
CREATE POLICY "service_role_all_staff_schedule_assignments"
  ON public.staff_schedule_assignments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_staff_schedule_assignments"
  ON public.staff_schedule_assignments FOR ALL TO authenticated
  USING (public.is_staff_member()) WITH CHECK (public.is_staff_member());
