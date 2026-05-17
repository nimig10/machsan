-- Option B (half-auto): when a director approves a self-applied crew request,
-- delete ONE matching empty placeholder slot (a row the director left empty in
-- the editor — invited_by='director', student_id IS NULL, no free_text_name).
-- Other pending applications for the same role stay as 'invited' for the
-- director to manually reject — that is the user-chosen tradeoff.
--
-- Match criteria for a placeholder to consume:
--   • same production_id
--   • invited_by = 'director'
--   • student_id IS NULL
--   • free_text_name IS NULL OR free_text_name = ''
--   • same role
--   • when role = 'custom', also same role_label
--
-- If no matching placeholder exists (director never created one, or already
-- consumed in a prior approval), nothing is deleted — behaviour falls back to
-- the previous version. So the v2 is strictly additive.

CREATE OR REPLACE FUNCTION public.production_approve_crew_v1(p_crew_id text, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_crew              record;
  v_director_em       text;
  v_jwt_email         text;
  v_conflict          jsonb;
  v_is_director       boolean;
  v_is_invitee        boolean;
  v_placeholder_id    text;
BEGIN
  IF p_crew_id IS NULL OR p_crew_id = '' THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_crew_id is required';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'production_approve_crew_v1: p_decision must be approved or rejected (got %)', p_decision;
  END IF;

  SELECT pc.id, pc.production_id, pc.role, pc.role_label, pc.student_id, pc.status,
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

  -- Option B (this migration): when approving a self-applied request, consume
  -- one matching empty placeholder slot from the director's draft.
  IF p_decision = 'approved'
     AND v_crew.invited_by = 'self'
     AND v_is_director THEN
    SELECT pc2.id
      INTO v_placeholder_id
      FROM public.production_crew pc2
     WHERE pc2.production_id = v_crew.production_id
       AND pc2.invited_by    = 'director'
       AND pc2.student_id    IS NULL
       AND (pc2.free_text_name IS NULL OR pc2.free_text_name = '')
       AND pc2.role          = v_crew.role
       AND (v_crew.role <> 'custom' OR COALESCE(pc2.role_label,'') = COALESCE(v_crew.role_label,''))
     ORDER BY pc2.created_at ASC
     LIMIT 1;

    IF v_placeholder_id IS NOT NULL THEN
      DELETE FROM public.production_crew WHERE id = v_placeholder_id;
    END IF;
  END IF;

  IF p_decision = 'approved' AND v_crew.role IN ('photographer','sound') THEN
    PERFORM public.production_crew_change_recheck_v1(v_crew.production_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'crew_id', p_crew_id,
    'status', p_decision,
    'placeholder_consumed', v_placeholder_id
  );
END;
$function$;
