-- Feature: Google Calendar sync for course sessions (ICS email invites).
--
-- Maps each (lesson session × lecturer) to the calendar VEVENT that was emailed
-- to that lecturer, so /api/calendar-sync can RECONCILE against the live lesson
-- state on every save:
--   * new / changed (session_key,lecturer) -> send METHOD:REQUEST (same UID,
--     SEQUENCE++ on change) and store the new hash/sequence,
--   * removed (session deleted / lecturer unassigned / course deleted) ->
--     send METHOD:CANCEL and mark the row 'cancelled',
--   * unchanged -> skip (idempotent; a re-save sends nothing).
--
-- `uid` is deterministic (machsan-{lesson}-{session_key}-{lecturer}@camera.org.il)
-- and survives date/time edits so Google updates the existing event in place
-- instead of creating a duplicate. `last_hash` detects real content changes.
--
-- Read/written ONLY via the service-role API (/api/calendar-sync); no browser
-- client access. Mirrors staff_personal_tasks / staff_schedule_*: RLS enabled,
-- NO policies (service role bypasses RLS), NOT added to supabase_realtime.

CREATE TABLE IF NOT EXISTS public.lesson_calendar_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id      text        NOT NULL,              -- = public.lessons.id
  session_key    text        NOT NULL,              -- = schedule[]._key (stable)
  lecturer_id    text        NOT NULL,              -- = public.lecturers.id
  lecturer_email text        NOT NULL,
  uid            text        NOT NULL,              -- iCalendar VEVENT UID
  sequence       integer     NOT NULL DEFAULT 0,    -- iCalendar SEQUENCE
  last_hash      text,                              -- content hash (change detect)
  status         text        NOT NULL DEFAULT 'active',  -- active | cancelled
  -- Snapshot of the last-sent event time/title so a CANCEL can reproduce a
  -- faithful DTSTART/DTEND (Outlook matches cancellations on time, not just UID)
  -- even after the source session/course row is gone.
  event_date     date,
  start_time     text,
  end_time       text,
  summary        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, session_key, lecturer_id)
);

-- Reconcile always loads by lesson_id.
CREATE INDEX IF NOT EXISTS idx_lesson_calendar_events_lesson
  ON public.lesson_calendar_events (lesson_id);

-- Reuse the shared touch_updated_at() trigger fn (already defined in the DB;
-- migrations/029_create_students_tables.sql). Do NOT redefine it.
DROP TRIGGER IF EXISTS lesson_calendar_events_touch_updated_at ON public.lesson_calendar_events;
CREATE TRIGGER lesson_calendar_events_touch_updated_at
  BEFORE UPDATE ON public.lesson_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS on, no policies -> API-only (service role). Matches staff_personal_tasks.
ALTER TABLE public.lesson_calendar_events ENABLE ROW LEVEL SECURITY;
