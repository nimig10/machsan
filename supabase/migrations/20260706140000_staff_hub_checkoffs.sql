-- Unified "done" tracking for the Staff Hub "משימות להיום" panel items that live
-- on other tables and have no done column of their own: the daily shift tasks
-- (staff_daily_tasks) and the manager/own notes (staff_schedule_assignments /
-- staff_schedule_preferences). Presence of a row = that item is checked off by
-- the staff member for that day.
--
-- (Personal tasks and loan-handling requests carry their own `done` column.)
--
-- Private per staff member; read/written ONLY via the service-role API
-- (/api/staff-schedule). RLS on, NO policies — matches staff_schedule_* tables.

CREATE TABLE IF NOT EXISTS public.staff_hub_checkoffs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid        NOT NULL,
  date       date        NOT NULL,
  item_type  text        NOT NULL CHECK (item_type IN ('daily','manager_note','my_note')),
  item_ref   text        NOT NULL,   -- daily: task_key ; notes: 'note'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, date, item_type, item_ref)
);

CREATE INDEX IF NOT EXISTS idx_staff_hub_checkoffs_staff_date
  ON public.staff_hub_checkoffs (staff_id, date);

ALTER TABLE public.staff_hub_checkoffs ENABLE ROW LEVEL SECURITY;
