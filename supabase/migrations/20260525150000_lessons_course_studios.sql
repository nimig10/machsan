-- Add explicit course-level classrooms column to lessons.
--
-- Previously, `lesson.studios[]` was derived on read from `lesson.studio_id` +
-- the union of all `session.studioIds[]` across the schedule. That mixed two
-- distinct concepts:
--   * Course-level classrooms — the chips the user adds in the "שיוך כיתות
--     לימוד" panel (each adds a column to the schedule table).
--   * Session-level overrides — a per-session classroom choice that the
--     user makes inline in the schedule table.
--
-- The derivation pulled overrides into the course list, so on re-open the
-- override appeared as a new column. This column gives `course_studios` its
-- own home so the two concerns stay independent.
--
-- Shape: jsonb array of `{ studioId: "<uuid-or-id>" }` objects, mirroring the
-- in-memory `lesson.studios` shape used by LessonsPage.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS course_studios jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lessons.course_studios IS
  'Explicit course-level classrooms (chips in the "שיוך כיתות לימוד" panel). Distinguishes a course-level studio from a per-session override stored in schedule[i].studioIds.';
