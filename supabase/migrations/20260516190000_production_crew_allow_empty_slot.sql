-- Allow empty crew rows: both student_id and free_text_name may be NULL.
-- This represents an open slot the director defined that students can self-
-- enroll into via "בקשת הצטרפות". The previous constraint required exactly
-- one of student_id/free_text_name; we relax it to "not both set" so an
-- empty row (open slot) is valid.

ALTER TABLE public.production_crew DROP CONSTRAINT IF EXISTS production_crew_check;

ALTER TABLE public.production_crew
  ADD CONSTRAINT production_crew_student_or_text_not_both
  CHECK (NOT (student_id IS NOT NULL AND free_text_name IS NOT NULL));

-- Trigger update: photographer/sound rows can be empty (NULL student, NULL text)
-- but cannot use free-text (cert lookup at loan time needs a real student).
CREATE OR REPLACE FUNCTION public.production_crew_photographer_sound_must_be_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IN ('photographer','sound') AND NEW.free_text_name IS NOT NULL THEN
    RAISE EXCEPTION 'production_crew: role % cannot use free_text_name; must be a registered student or left empty (open slot)',
                    NEW.role;
  END IF;
  RETURN NEW;
END;
$$;
