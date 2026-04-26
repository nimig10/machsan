-- 030_students_tables_rls.sql
-- Stage 6 step 7: enable RLS on the four normalized tables created by
-- migration 029.
--
-- Policy model (mirrors the existing pattern from store / reservations_new):
--   • service_role  — full bypass (used by /api/* endpoints with service key)
--   • staff_member  — full read/write (uses is_staff_member() helper)
--   • authenticated — read-only across all rows
--   • anon          — NO access (no policy = denied)
--
-- Known limitation (TODO before production):
--   The existing /api/store handler redacts phone fields for non-staff.
--   After step 5 the client reads students directly via supabase JS, which
--   bypasses that redaction. Authenticated non-staff users can currently
--   see all students' phones. Address this with a redacted view OR a
--   server-side /api/students endpoint BEFORE enabling RLS in production.
--   For develop branch this is acceptable (test data only).

-- ============================================================
-- ① students
-- ============================================================
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students FORCE ROW LEVEL SECURITY;  -- service_role still bypasses

DROP POLICY IF EXISTS students_service_role_all ON public.students;
CREATE POLICY students_service_role_all ON public.students
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS students_staff_all ON public.students;
CREATE POLICY students_staff_all ON public.students
  FOR ALL TO public
  USING (is_staff_member()) WITH CHECK (is_staff_member());

DROP POLICY IF EXISTS students_authenticated_read ON public.students;
CREATE POLICY students_authenticated_read ON public.students
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- ② certification_types
-- ============================================================
ALTER TABLE public.certification_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certification_types FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cert_types_service_role_all ON public.certification_types;
CREATE POLICY cert_types_service_role_all ON public.certification_types
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cert_types_staff_all ON public.certification_types;
CREATE POLICY cert_types_staff_all ON public.certification_types
  FOR ALL TO public
  USING (is_staff_member()) WITH CHECK (is_staff_member());

DROP POLICY IF EXISTS cert_types_authenticated_read ON public.certification_types;
CREATE POLICY cert_types_authenticated_read ON public.certification_types
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- ③ tracks
-- ============================================================
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracks_service_role_all ON public.tracks;
CREATE POLICY tracks_service_role_all ON public.tracks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tracks_staff_all ON public.tracks;
CREATE POLICY tracks_staff_all ON public.tracks
  FOR ALL TO public
  USING (is_staff_member()) WITH CHECK (is_staff_member());

DROP POLICY IF EXISTS tracks_authenticated_read ON public.tracks;
CREATE POLICY tracks_authenticated_read ON public.tracks
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- ④ student_certifications
-- ============================================================
ALTER TABLE public.student_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_certifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_certs_service_role_all ON public.student_certifications;
CREATE POLICY student_certs_service_role_all ON public.student_certifications
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS student_certs_staff_all ON public.student_certifications;
CREATE POLICY student_certs_staff_all ON public.student_certifications
  FOR ALL TO public
  USING (is_staff_member()) WITH CHECK (is_staff_member());

DROP POLICY IF EXISTS student_certs_authenticated_read ON public.student_certifications;
CREATE POLICY student_certs_authenticated_read ON public.student_certifications
  FOR SELECT TO authenticated
  USING (true);
