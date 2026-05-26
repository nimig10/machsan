-- Add explicit course-level lecturer chips column to lessons.
--
-- Mirrors `course_studios` from 20260525150000 — same problem, same solution.
-- Previously `lesson.lecturers[]` was derived on read from `lesson.lecturer_id`
-- (course primary, single) + the union of all `session.lecturerId` / new
-- `session.lecturerIds[]` across the schedule. With multi-lecturer columns
-- (feat/multi-lecturer-columns), session-level overrides bleed back into the
-- course list on reload and would create phantom column entries.
--
-- Giving `course_lecturers` its own column keeps the two concerns independent:
--   * Course-level lecturers — the chips the user adds in the "מרצי הקורס"
--     panel. Each is available as an option in any lecturer column dropdown
--     in the schedule grid.
--   * Session-level overrides — a per-session lecturer choice that the user
--     makes inline in the schedule table, stored as `schedule[].lecturerIds`.
--
-- Shape: jsonb array of `{ lecturerId: "<uuid-or-id>" }` objects, mirroring
-- the in-memory `lesson.lecturers` shape used by LessonsPage. Names are NOT
-- stored — resolved from `public.lecturers` on read.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS course_lecturers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lessons.course_lecturers IS
  'Explicit course-level lecturers (chips in the "מרצי הקורס" panel). Distinguishes a course-level lecturer from a per-session override stored in schedule[i].lecturerIds.';
