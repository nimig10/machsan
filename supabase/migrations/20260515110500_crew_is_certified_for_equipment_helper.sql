-- Productions board (לוח הפקות) — Session 6/N: cert-check helper.
-- Mirror of the JS `crewIsCertifiedForEq` at src/components/PublicForm.jsx
-- (~line 3168). Used by:
--   - production_crew_change_recheck_v1 (server-side trigger on crew changes)
--   - any future server-side cert validation
--
-- Rules:
-- 1. Equipment without certification_id → always allowed.
-- 2. Otherwise: photographer OR sound (whichever passed) certifies the gear.
-- Free-text crew rows (student_id=NULL) never participate — passed as NULL.
-- "קולנוע יומית" override is NOT in this helper because it never applies
-- to production loans (cert IS checked for productions).

CREATE OR REPLACE FUNCTION public.crew_is_certified_for_equipment(
  p_photog_student_id text,
  p_sound_student_id  text,
  p_equipment_id      text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cert_id text;
BEGIN
  IF p_equipment_id IS NULL OR p_equipment_id = '' THEN
    RETURN TRUE;
  END IF;

  SELECT certification_id INTO v_cert_id
    FROM public.equipment
   WHERE id = p_equipment_id;

  IF NOT FOUND OR v_cert_id IS NULL OR v_cert_id = '' THEN
    RETURN TRUE;
  END IF;

  IF p_photog_student_id IS NOT NULL THEN
    PERFORM 1
      FROM public.student_certifications
     WHERE student_id   = p_photog_student_id
       AND cert_type_id = v_cert_id
       AND status       = 'עבר';
    IF FOUND THEN
      RETURN TRUE;
    END IF;
  END IF;

  IF p_sound_student_id IS NOT NULL THEN
    PERFORM 1
      FROM public.student_certifications
     WHERE student_id   = p_sound_student_id
       AND cert_type_id = v_cert_id
       AND status       = 'עבר';
    IF FOUND THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.crew_is_certified_for_equipment(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.crew_is_certified_for_equipment(text,text,text) TO service_role;
