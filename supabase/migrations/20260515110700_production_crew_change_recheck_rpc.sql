-- Productions board (לוח הפקות) — Session 8/N: re-check certifications after
-- crew change. Replaces the simplistic "photographer drop → flip to ממתין".
--
-- Per user spec: a reservation flips to 'ממתין' ONLY when the post-change
-- crew (photographer + sound) is NOT certified for the equipment in that
-- reservation. If the remaining crew still passes certification, the
-- reservation is untouched.
--
-- Fired from:
--   - AFTER DELETE on production_crew (when row was approved)
--   - AFTER UPDATE on production_crew (status moves out of approved
--     OR student_id changes)
--   - Manual call from production_approve_crew_v1 after approving a new
--     photographer/sound (newly-certified crew may UN-block a reservation
--     that was previously flagged).

CREATE OR REPLACE FUNCTION public.production_crew_change_recheck_v1(
  p_production_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_res            record;
  v_item           record;
  v_photog_id      text;
  v_sound_id       text;
  v_flipped_ids    text[] := ARRAY[]::text[];
  v_uncertified    boolean;
BEGIN
  IF p_production_id IS NULL OR p_production_id = '' THEN
    RAISE EXCEPTION 'production_crew_change_recheck_v1: p_production_id is required';
  END IF;

  -- Snapshot current approved photographer + sound on this production
  -- (NULL if role is not currently filled).
  SELECT student_id INTO v_photog_id
    FROM public.production_crew
   WHERE production_id = p_production_id
     AND role          = 'photographer'
     AND status        = 'approved'
   LIMIT 1;

  SELECT student_id INTO v_sound_id
    FROM public.production_crew
   WHERE production_id = p_production_id
     AND role          = 'sound'
     AND status        = 'approved'
   LIMIT 1;

  FOR v_res IN
    SELECT id, status
      FROM public.reservations_new
     WHERE production_id = p_production_id
       AND status IN ('מאושר','אישור ראש מחלקה','ממתין')
  LOOP
    v_uncertified := FALSE;

    FOR v_item IN
      SELECT equipment_id
        FROM public.reservation_items
       WHERE reservation_id = v_res.id
         AND equipment_id IS NOT NULL
    LOOP
      IF NOT public.crew_is_certified_for_equipment(v_photog_id, v_sound_id, v_item.equipment_id) THEN
        v_uncertified := TRUE;
        EXIT;
      END IF;
    END LOOP;

    IF v_uncertified THEN
      IF v_res.status <> 'ממתין' THEN
        UPDATE public.reservations_new
           SET status     = 'ממתין',
               updated_at = NOW()
         WHERE id = v_res.id;
        v_flipped_ids := array_append(v_flipped_ids, v_res.id);

        INSERT INTO public.activity_logs (
          user_id, user_name, action, entity, entity_id, details
        ) VALUES (
          'system', 'production_crew_recheck',
          'reservation_status_flip',
          'reservation', v_res.id,
          jsonb_build_object(
            'production_id',     p_production_id,
            'old_status',        v_res.status,
            'new_status',        'ממתין',
            'reason',            'crew_change_uncertified',
            'photographer_id',   v_photog_id,
            'sound_id',          v_sound_id
          )
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'flipped',     v_flipped_ids,
    'photog_id',   v_photog_id,
    'sound_id',    v_sound_id
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_crew_change_recheck_v1(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_crew_change_recheck_v1(text) TO service_role;

-- AFTER-DELETE / AFTER-UPDATE triggers that fire the recheck whenever a crew
-- row changes in a way that could affect cert eligibility for reservations.
CREATE OR REPLACE FUNCTION public.production_crew_after_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $trg$
DECLARE
  v_target_production text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' AND OLD.role IN ('photographer','sound') THEN
      v_target_production := OLD.production_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status moved out of approved, or student_id changed under approved.
    IF OLD.role IN ('photographer','sound')
       OR NEW.role IN ('photographer','sound') THEN
      IF (OLD.status = 'approved' AND NEW.status <> 'approved')
         OR (OLD.status = 'approved' AND OLD.student_id IS DISTINCT FROM NEW.student_id)
      THEN
        v_target_production := NEW.production_id;
      END IF;
    END IF;
  END IF;

  IF v_target_production IS NOT NULL THEN
    PERFORM public.production_crew_change_recheck_v1(v_target_production);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS production_crew_after_delete ON public.production_crew;
CREATE TRIGGER production_crew_after_delete
  AFTER DELETE ON public.production_crew
  FOR EACH ROW EXECUTE FUNCTION public.production_crew_after_change_trigger();

DROP TRIGGER IF EXISTS production_crew_after_update ON public.production_crew;
CREATE TRIGGER production_crew_after_update
  AFTER UPDATE ON public.production_crew
  FOR EACH ROW EXECUTE FUNCTION public.production_crew_after_change_trigger();
