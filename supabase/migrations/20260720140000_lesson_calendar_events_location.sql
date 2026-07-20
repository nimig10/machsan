-- lesson_calendar_events.location
--
-- The course→calendar sync emails the lecturer a "what changed" notice when the
-- secretariat edits a course after it was first sent. Producing that notice
-- needs a BEFORE snapshot of every session, and the table already stores
-- event_date / start_time / end_time / summary for exactly that reason.
-- `location` was missing, so a room change ("DIGITAL MIX ROOM" → "MAIN CONTROL")
-- could be detected via last_hash but not described to the lecturer.
--
-- Nullable with no default: existing rows keep NULL and simply render no
-- "room changed" line until their next sync refreshes the snapshot.

ALTER TABLE public.lesson_calendar_events
  ADD COLUMN IF NOT EXISTS location text;
