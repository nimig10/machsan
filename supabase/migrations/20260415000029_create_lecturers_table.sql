-- Stage 7 step 1 — normalize store.lecturers JSONB blob into a real table.
-- Mirror of Stage 6's students table pattern. Reads still go to the blob;
-- this migration is purely additive (CREATE TABLE only).

CREATE TABLE IF NOT EXISTS public.lecturers (
  id            text        PRIMARY KEY,
  first_name    text        NOT NULL DEFAULT '',
  last_name     text        NOT NULL DEFAULT '',
  full_name     text        NOT NULL,
  phone         text,
  email         text,
  study_tracks  text[]      NOT NULL DEFAULT '{}',
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Auth lookup index — case-insensitive UNIQUE to prevent duplicate emails
-- across the app (matches the dedupe logic in LecturersPage.findDuplicate).
CREATE UNIQUE INDEX IF NOT EXISTS lecturers_email_lower_idx
  ON public.lecturers (lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Filter on active lecturers (LecturersPage / lecturer dropdowns).
CREATE INDEX IF NOT EXISTS lecturers_is_active_idx
  ON public.lecturers (is_active);

-- Membership lookup for "lecturers in track X" queries.
CREATE INDEX IF NOT EXISTS lecturers_study_tracks_gin_idx
  ON public.lecturers USING GIN (study_tracks);

-- Reuse the touch_updated_at() function defined in Stage 6 (students migration).
DROP TRIGGER IF EXISTS lecturers_touch_updated_at ON public.lecturers;
CREATE TRIGGER lecturers_touch_updated_at
  BEFORE UPDATE ON public.lecturers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
