-- Feature: "משימות להיום" — free-text personal to-do items a staff member adds
-- for a given day, shown in the Staff Hub "Tasks for Today" panel.
--
-- Private per staff member. Read/written ONLY via the service-role API
-- (/api/staff-schedule); no browser client access.
--
-- Mirrors the staff_schedule_* tables: RLS enabled, NO policies (service role
-- bypasses RLS). Deliberately NOT added to supabase_realtime and NO SELECT
-- policy — these rows are private and never read from the browser client.

CREATE TABLE IF NOT EXISTS public.staff_personal_tasks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid        NOT NULL,              -- = public.users.id
  date       date        NOT NULL,
  text       text        NOT NULL,
  done       boolean     NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Query pattern is always staff_id + date (see the my-today API action).
CREATE INDEX IF NOT EXISTS idx_staff_personal_tasks_staff_date
  ON public.staff_personal_tasks (staff_id, date);

-- Reuse the shared touch_updated_at() trigger fn (already defined in the DB;
-- migrations/029_create_students_tables.sql). Do NOT redefine it.
DROP TRIGGER IF EXISTS staff_personal_tasks_touch_updated_at ON public.staff_personal_tasks;
CREATE TRIGGER staff_personal_tasks_touch_updated_at
  BEFORE UPDATE ON public.staff_personal_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS on, no policies -> API-only (service role). Matches staff_schedule_* tables.
ALTER TABLE public.staff_personal_tasks ENABLE ROW LEVEL SECURITY;
