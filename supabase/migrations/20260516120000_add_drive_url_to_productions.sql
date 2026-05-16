-- Productions board: shareable link (Google Drive / Dropbox / other) for the
-- synopsis / script / folder of the production. Optional, free-form URL.
-- Stored on the productions row directly (small, ~200 bytes max).
ALTER TABLE public.productions
  ADD COLUMN IF NOT EXISTS drive_url text;

-- Loose URL shape check — just ensure it starts with http(s):// when set.
-- Anything stricter would break legitimate share URLs (Drive, Dropbox, OneDrive,
-- iCloud, etc all use different domain patterns).
ALTER TABLE public.productions
  DROP CONSTRAINT IF EXISTS productions_drive_url_format;
ALTER TABLE public.productions
  ADD CONSTRAINT productions_drive_url_format
    CHECK (drive_url IS NULL OR drive_url ~* '^https?://');
