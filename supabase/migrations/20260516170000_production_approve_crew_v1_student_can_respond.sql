-- Extend production_approve_crew_v1 to also accept the invited student themselves.
-- Two cases now supported (caller authorization):
--   A) Caller IS the director of the production (existing behavior — used to
--      approve/reject self-enrollment requests).
--   B) Caller's email matches crew_email AND the row is invitedBy='director'
--      AND status='invited' — i.e., a student responding to a director's
--      direct invitation.

CREATE OR REPLACE FUNCTION public.production_approve_crew_v1(p_crew_id text, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_crew        record;
  v_director_em text;
  v_jwt_email   text;
  v_conflict    jsonb;
  v_is_director boolean;
  v_is_invitee  boolean;
BEGIN
  IF p_crew_id IS NULL OR p_crew_id = '' THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_crew_id is required';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_decision must be approved or rejected (got %)', p_decision;
  END IF;

  SELECT pc.id, pc.production_id, pc.role, pc.student_id, pc.status,
         pc.invited_by, pc.crew_email,
         p.director_email
    INTO v_crew
    FROM public.production_crew pc
    JOIN public.productions p ON p.id = pc.production_id
   WHERE pc.id = p_crew_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_approve_crew_v1: crew row % not found', p_crew_id;
  END IF;

  v_jwt_email   := lower(auth.jwt() ->> 'email');
  v_director_em := lower(v_crew.director_email);

  v_is_director := v_jwt_email IS NOT NULL
               AND v_jwt_email <> ''
               AND v_jwt_email = v_director_em;

  v_is_invitee  := v_jwt_email IS NOT NULL
               AND v_jwt_email <> ''
               AND v_crew.crew_email IS NOT NULL
               AND lower(v_crew.crew_email) = v_jwt_email
               AND v_crew.invited_by = 'director'
               AND v_crew.status = 'invited';

  IF NOT (v_is_director OR v_is_invitee) THEN
    RAISE EXCEPTION 'production_approve_crew_v1: caller is neither the director nor the invited student of this production';
  END IF;

  IF v_crew.status = p_decision THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  IF p_decision = 'approved' AND v_crew.student_id IS NOT NULL THEN
    v_conflict := public.production_check_crew_conflict_v1(v_crew.student_id, v_crew.production_id);
    IF (v_conflict->>'ok')::boolean = FALSE THEN
      RAISE EXCEPTION 'production_approve_crew_v1: student is already approved on another production with overlapping dates (%)',
                      v_conflict->'conflicts';
    END IF;
  END IF;

  UPDATE public.production_crew
     SET status     = p_decision,
         updated_at = NOW()
   WHERE id = p_crew_id;

  IF p_decision = 'approved' AND v_crew.role IN ('photographer','sound') THEN
    PERFORM public.production_crew_change_recheck_v1(v_crew.production_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'crew_id', p_crew_id, 'status', p_decision);
END;
$function$;
