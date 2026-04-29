-- Stage 8 Session A step 2 — normalize store.lessons JSONB blob into a real table.
-- Mirror of Stage 7's lecturers migration pattern. Reads still go to the blob;
-- this migration is purely additive (CREATE TABLE + RLS only). Session B will
-- flip readers, Session C will drop the blob.
--
-- Decisions (per Stage 8 plan):
-- - schedule[] stays as JSONB column (no junction; reservation generation reads
--   the entire array per lesson — no cross-lesson schedule queries exist).
-- - student_statuses stays as JSONB column (sparse keys, only aggregate is "count
--   decided per track" in LecturerPortal — JSONB wins on simplicity + atomic write).

CREATE TABLE IF NOT EXISTS public.lessons (
  id                          text        PRIMARY KEY,
  name                        text        NOT NULL,
  track                       text,
  lecturer_id                 text        REFERENCES public.lecturers(id) ON DELETE SET NULL,
  -- Denormalized fallback fields (transitional — kept until consumers migrated
  -- to read lecturer_id → public.lecturers join). Mirrors the blob shape.
  instructor_name             text,
  instructor_phone            text,
  instructor_email            text,
  description                 text,
  studio_id                   text,
  certificate_template_type   text,
  -- Cron-managed flag for "7 days before course end" lecturer notification
  -- (api/notify-course-end-7days.js). Idempotency primitive — must survive
  -- across the dual-write window.
  lecturer_notified_at_7d     timestamptz,
  -- Nested arrays kept as JSONB columns. See header for rationale.
  schedule                    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  student_statuses            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- FK lookup index for "all lessons taught by lecturer X" (LecturerPortal,
-- LecturersPage list filtering, notify-course-end-7days).
CREATE INDEX IF NOT EXISTS lessons_lecturer_id_idx
  ON public.lessons (lecturer_id);

-- GIN index on schedule for (date, kitId) lookups used by the legacy reservation
-- generation path. Keeps existing reads cheap until Stage 8 cleanup retires
-- buildLessonReservations entirely.
CREATE INDEX IF NOT EXISTS lessons_schedule_gin_idx
  ON public.lessons USING GIN (schedule);

-- Reuse the touch_updated_at() function defined in Stage 6 (students migration).
DROP TRIGGER IF EXISTS lessons_touch_updated_at ON public.lessons;
CREATE TRIGGER lessons_touch_updated_at
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Mirror of Stage 7 lecturers RLS. Session A is a parallel write target; reads
-- still flow through store.lessons blob. Session B will flip consumers.

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessons_service_role_all ON public.lessons;
CREATE POLICY lessons_service_role_all
  ON public.lessons
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS lessons_staff_all ON public.lessons;
CREATE POLICY lessons_staff_all
  ON public.lessons
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Authenticated users (lecturers, students) need SELECT for the lecturer
-- portal + public daily-table page. Same precedent as lecturers RLS.
DROP POLICY IF EXISTS lessons_authenticated_read ON public.lessons;
CREATE POLICY lessons_authenticated_read
  ON public.lessons
  FOR SELECT
  TO authenticated
  USING (true);
-- Note on anon: PublicDisplayPage / PublicDailyTablePage currently read lessons
-- via /api/store with service-role. We keep that proxy alive through Session B
-- and add a narrow anon SELECT policy only when those pages flip to direct
-- table reads (Session C decision).
