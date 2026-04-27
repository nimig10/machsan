-- Stage 6 follow-up: tracks + certification_types are configuration data
-- (track names, allowed loan types, certification labels). They MUST be
-- readable by the public form BEFORE login, otherwise the form can't
-- filter loan types / studios per student track and falls back to "show
-- everything". Personal data tables (students, student_certifications)
-- STAY authenticated-only — those policies are unchanged.

-- tracks: allow anon SELECT
DROP POLICY IF EXISTS tracks_authenticated_read ON public.tracks;
CREATE POLICY tracks_public_read ON public.tracks
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- certification_types: allow anon SELECT (just labels, no PII)
DROP POLICY IF EXISTS cert_types_authenticated_read ON public.certification_types;
CREATE POLICY cert_types_public_read ON public.certification_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Repair: clean up orphaned auth_entity_map rows whose auth_user_id no
-- longer exists in auth.users. These break upsert with on_conflict=auth_user_id
-- because the row collides on the OTHER unique key (entity_type, entity_id).
DELETE FROM public.auth_entity_map m
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = m.auth_user_id
);

-- Repair: also remove auth_entity_map rows pointing to a deleted student.
DELETE FROM public.auth_entity_map m
WHERE m.entity_type = 'student'
  AND NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = m.entity_id
  );
