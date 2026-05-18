-- Productions board: allow free-text custom crew roles in addition to the
-- 5 standard roles. The role column gains a 'custom' value, and a paired
-- `role_label` column holds the user-supplied Hebrew label (e.g. "תאורן",
-- "צבע", "מנהל הפקה"). For the 5 standard roles, role_label stays NULL
-- (UI uses the hardcoded ROLE_LABELS map).
--
-- Photographer (now displayed as "צלם ראשי") + sound still require a real
-- registered student — the existing trigger production_crew_photographer_sound_must_be_student
-- is unchanged. Custom roles can be student OR free_text_name (same as the
-- other non-photographer roles).

ALTER TABLE public.production_crew
  DROP CONSTRAINT IF EXISTS production_crew_role_check;
ALTER TABLE public.production_crew
  ADD CONSTRAINT production_crew_role_check
    CHECK (role IN ('photographer','sound','assistant_photographer','assistant_director','producer','custom'));

ALTER TABLE public.production_crew
  ADD COLUMN IF NOT EXISTS role_label text;

ALTER TABLE public.production_crew
  DROP CONSTRAINT IF EXISTS production_crew_role_label_consistency;
ALTER TABLE public.production_crew
  ADD CONSTRAINT production_crew_role_label_consistency
    CHECK (
      (role = 'custom' AND role_label IS NOT NULL AND char_length(trim(role_label)) > 0 AND char_length(role_label) <= 40)
      OR (role <> 'custom' AND role_label IS NULL)
    );
