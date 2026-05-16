-- Productions board: per-production color (director-chosen) used by the
-- calendar blocks and the list cards. Stored as a 6-digit hex; the UI picks
-- from a fixed palette but the column accepts any valid hex for future flexibility.
ALTER TABLE public.productions
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.productions
  DROP CONSTRAINT IF EXISTS productions_color_format;
ALTER TABLE public.productions
  ADD CONSTRAINT productions_color_format
    CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
