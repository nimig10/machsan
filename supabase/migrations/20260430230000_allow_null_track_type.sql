-- 20260430230000_allow_null_track_type.sql
--
-- Allow public.tracks.track_type to be NULL, representing the "ללא סיווג"
-- (no classification) option in the StudentsPage track editor.
--
-- BUG IT FIXES:
--   The UI dropdown offered three values — "ללא סיווג" (""), "🎧 הנדסאי סאונד"
--   ("sound"), "🎬 הנדסאי קולנוע" ("cinema"). The DB column was NOT NULL with
--   CHECK (track_type IN ('cinema','sound')), so the empty option had nowhere
--   to land. syncTracks() was silently coercing the empty value to 'cinema',
--   meaning users could never actually save a track without a classification.
--
-- AFTER THIS MIGRATION:
--   * track_type is nullable
--   * CHECK now permits NULL or 'cinema' or 'sound'
--   * studentsApi.syncTracks() writes null for empty trackType (paired commit)
--   * studentsApi.loadCertificationsFromTables() reads null back as "" so the
--     UI <select> matches the "ללא סיווג" option

ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_track_type_check;
ALTER TABLE public.tracks ALTER COLUMN track_type DROP NOT NULL;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_track_type_check
  CHECK (track_type IS NULL OR track_type = ANY (ARRAY['cinema'::text, 'sound'::text]));
