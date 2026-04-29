-- Stage 9 Session A — normalize store.studios JSONB blob into a real table.
-- Mirror of Stage 7 (lecturers) / Stage 8 (lessons) pattern. Reads still go
-- to the blob; this migration is purely additive (CREATE TABLE + RLS only).
-- Session B will flip readers, Session C will drop the blob.

CREATE TABLE IF NOT EXISTS public.studios (
  id                  text        PRIMARY KEY,
  name                text        NOT NULL,
  studio_type         text,
  image               text,
  description         text,
  is_classroom        boolean     NOT NULL DEFAULT false,
  is_disabled         boolean     NOT NULL DEFAULT false,
  classroom_only      boolean     NOT NULL DEFAULT false,
  requires_approval   boolean     NOT NULL DEFAULT false,
  -- studio_cert_id is the legacy single-cert field; studio_cert_ids is the
  -- multi-cert array introduced in CertificationsPage. Both kept until the
  -- legacy single-cert field can be cleaned out across consumers.
  studio_cert_id      text,
  studio_cert_ids     text[]      NOT NULL DEFAULT '{}',
  studio_track_type   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Filter index for "classroom-only" lookups (lesson studio assignment paths).
CREATE INDEX IF NOT EXISTS studios_is_classroom_idx
  ON public.studios (is_classroom);

-- Reuse the touch_updated_at() function defined in Stage 6 (students migration).
DROP TRIGGER IF EXISTS studios_touch_updated_at ON public.studios;
CREATE TRIGGER studios_touch_updated_at
  BEFORE UPDATE ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Mirror of Stage 8 lessons RLS. Studios are written by staff via Cert/Booking
-- pages, read by everyone (incl. anonymous PublicForm/PublicDisplay/Public
-- DailyTable visitors).

ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studios_service_role_all ON public.studios;
CREATE POLICY studios_service_role_all
  ON public.studios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS studios_staff_all ON public.studios;
CREATE POLICY studios_staff_all
  ON public.studios
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Anon + authenticated read — PublicForm/PublicDisplay/PublicDailyTable need
-- studio data without auth. Same precedent as Stage 7 follow-up
-- (anon_read_lecturers).
DROP POLICY IF EXISTS studios_public_read ON public.studios;
CREATE POLICY studios_public_read
  ON public.studios
  FOR SELECT
  TO anon, authenticated
  USING (true);
