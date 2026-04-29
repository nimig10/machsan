-- Stage 7 follow-up: lecturers must be readable by the public form BEFORE
-- login so the lecturer-eligibility check (PublicForm.jsx:1672) can match
-- the auth email against an existing lecturer record. Without this, every
-- lecturer signing in falls through to "המשתמש לא נמצא במערכת" because
-- App.jsx loads the lecturers prop at mount (anon role) and gets [].
--
-- Same precedent as Stage 6 follow-up (20260415000028) which opened anon
-- SELECT on tracks + certification_types. Personal data tables (students,
-- student_certifications) stay authenticated-only — those policies are
-- unchanged.

DROP POLICY IF EXISTS lecturers_authenticated_read ON public.lecturers;
CREATE POLICY lecturers_public_read ON public.lecturers
  FOR SELECT
  TO anon, authenticated
  USING (true);
