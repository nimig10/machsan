-- Stage 7 step 2 — RLS for public.lecturers, mirroring Stage 6 students.
-- During Session A this is a parallel write target; reads still flow through
-- store.lecturers blob. Once Session B/C migrate consumers, these policies
-- will gate the actual auth + admin paths.

ALTER TABLE public.lecturers ENABLE ROW LEVEL SECURITY;

-- Service role bypass — used by api/auth.js and other server-side handlers.
DROP POLICY IF EXISTS lecturers_service_role_all ON public.lecturers;
CREATE POLICY lecturers_service_role_all
  ON public.lecturers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Staff (admin OR warehouse) get full CRUD via LecturersPage.
DROP POLICY IF EXISTS lecturers_staff_all ON public.lecturers;
CREATE POLICY lecturers_staff_all
  ON public.lecturers
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Authenticated users (lecturers, students, etc.) can read peers — required by
-- lecturer-kit + notify-course-end-7days flows that look up names/emails.
DROP POLICY IF EXISTS lecturers_authenticated_read ON public.lecturers;
CREATE POLICY lecturers_authenticated_read
  ON public.lecturers
  FOR SELECT
  TO authenticated
  USING (true);
-- No anon policy: anonymous visitors don't need lecturer data. The login
-- flow runs with service_role on the server, so this doesn't break it.
