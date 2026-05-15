-- Productions board (לוח הפקות) — Session 9/N: approve/reject crew request.
-- SECURITY DEFINER: bypasses RLS so the conflict check sees all productions,
-- but explicitly enforces "caller is director" by matching auth.jwt() email
-- against the production's director_email.
-- On approve (when role is photographer/sound) we explicitly call
-- production_crew_change_recheck_v1 because the AFTER-UPDATE trigger
-- only fires on transitions OUT of 'approved'.

CREATE OR REPLACE FUNCTION public.production_approve_crew_v1(
  p_crew_id  text,
  p_decision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_crew        record;
  v_director_em text;
  v_jwt_email   text;
  v_conflict    jsonb;
BEGIN
  IF p_crew_id IS NULL OR p_crew_id = '' THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_crew_id is required';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_decision must be approved or rejected (got %)', p_decision;
  END IF;

  SELECT pc.id, pc.production_id, pc.role, pc.student_id, pc.status,
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

  IF v_jwt_email IS NULL OR v_jwt_email = '' OR v_jwt_email <> v_director_em THEN
    RAISE EXCEPTION 'production_approve_crew_v1: caller is not the director of this production';
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_approve_crew_v1(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_approve_crew_v1(text,text) TO authenticated, service_role;
