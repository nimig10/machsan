-- Productions board (לוח הפקות) — Session 3/N: production_crew table.
-- Crew members of a production. Roles photographer + sound MUST be a real
-- student (FK student_id). Other three roles can be free_text_name if the
-- person isn't a registered student.
-- invited_by='director' rows skip the approval step (status='approved' set
-- by app code). invited_by='self' rows start status='invited' and require
-- director approval via production_approve_crew_v1.

CREATE TABLE IF NOT EXISTS public.production_crew (
  id              text PRIMARY KEY,
  production_id   text NOT NULL REFERENCES public.productions(id) ON DELETE CASCADE,
  role            text NOT NULL
                    CHECK (role IN (
                      'photographer',
                      'sound',
                      'assistant_photographer',
                      'assistant_director',
                      'producer'
                    )),
  student_id      text REFERENCES public.students(id) ON DELETE SET NULL,
  free_text_name  text,
  status          text NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited','approved','rejected')),
  invited_by      text NOT NULL
                    CHECK (invited_by IN ('director','self')),
  crew_email      text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (free_text_name IS NULL))
);

-- Photographer + sound MUST be a registered student (cert lookup needs student_id).
CREATE OR REPLACE FUNCTION public.production_crew_photographer_sound_must_be_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IN ('photographer','sound') AND NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'production_crew: role %% requires a registered student_id (got free_text_name=%%)',
                    NEW.role, NEW.free_text_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_crew_role_guard ON public.production_crew;
CREATE TRIGGER production_crew_role_guard
  BEFORE INSERT OR UPDATE ON public.production_crew
  FOR EACH ROW EXECUTE FUNCTION public.production_crew_photographer_sound_must_be_student();

CREATE INDEX IF NOT EXISTS production_crew_production_idx
  ON public.production_crew (production_id);

CREATE INDEX IF NOT EXISTS production_crew_student_idx
  ON public.production_crew (student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS production_crew_approved_idx
  ON public.production_crew (production_id, role)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS production_crew_email_idx
  ON public.production_crew (lower(crew_email))
  WHERE crew_email IS NOT NULL;

DROP TRIGGER IF EXISTS production_crew_touch_updated_at ON public.production_crew;
CREATE TRIGGER production_crew_touch_updated_at
  BEFORE UPDATE ON public.production_crew
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.production_crew ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_crew_service_role_all ON public.production_crew;
CREATE POLICY production_crew_service_role_all
  ON public.production_crew
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS production_crew_staff_all ON public.production_crew;
CREATE POLICY production_crew_staff_all
  ON public.production_crew
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS production_crew_public_read_published ON public.production_crew;
CREATE POLICY production_crew_public_read_published
  ON public.production_crew
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_crew.production_id
       AND p.status = 'published'
  ));

-- Self-enroll: authenticated student can INSERT their own join request
-- only with status='invited' AND invited_by='self' AND crew_email==JWT.
DROP POLICY IF EXISTS production_crew_self_enroll_insert ON public.production_crew;
CREATE POLICY production_crew_self_enroll_insert
  ON public.production_crew
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'invited'
    AND invited_by = 'self'
    AND crew_email IS NOT NULL
    AND lower(crew_email) = lower(auth.jwt() ->> 'email')
  );

-- Director full CRUD on crew rows of their own production.
DROP POLICY IF EXISTS production_crew_director_manage ON public.production_crew;
CREATE POLICY production_crew_director_manage
  ON public.production_crew
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_crew.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_crew.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ));

-- Self-cancel: a student can withdraw their own still-pending invitation.
DROP POLICY IF EXISTS production_crew_self_withdraw ON public.production_crew;
CREATE POLICY production_crew_self_withdraw
  ON public.production_crew
  FOR DELETE TO authenticated
  USING (
    crew_email IS NOT NULL
    AND lower(crew_email) = lower(auth.jwt() ->> 'email')
    AND status = 'invited'
  );

-- A student can read their own crew rows (including invited/rejected) even
-- when the production is still a draft.
DROP POLICY IF EXISTS production_crew_self_read ON public.production_crew;
CREATE POLICY production_crew_self_read
  ON public.production_crew
  FOR SELECT TO authenticated
  USING (
    crew_email IS NOT NULL
    AND lower(crew_email) = lower(auth.jwt() ->> 'email')
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.production_crew;
