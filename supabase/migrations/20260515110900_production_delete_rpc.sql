-- Productions board (לוח הפקות) — Session 10/N: delete a production.
-- Hard-delete per user preference. Linked reservations are first set to
-- 'בוטל' via update_reservation_status_v1 (which inserts activity_logs
-- and lets the frontend trigger the cancellation email), THEN the
-- production is deleted. The reservation rows are PRESERVED — their
-- production_id is set to NULL by the FK ON DELETE SET NULL clause,
-- keeping the audit trail intact.

CREATE OR REPLACE FUNCTION public.production_delete_v1(
  p_production_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_production      record;
  v_jwt_email       text;
  v_director_em     text;
  v_reservation_id  text;
  v_cancelled_ids   text[] := ARRAY[]::text[];
BEGIN
  IF p_production_id IS NULL OR p_production_id = '' THEN
    RAISE EXCEPTION 'production_delete_v1: p_production_id is required';
  END IF;

  SELECT id, director_email INTO v_production
    FROM public.productions
   WHERE id = p_production_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_delete_v1: production % not found', p_production_id;
  END IF;

  v_jwt_email   := lower(auth.jwt() ->> 'email');
  v_director_em := lower(v_production.director_email);

  IF v_jwt_email IS NULL OR v_jwt_email = '' OR v_jwt_email <> v_director_em THEN
    -- Allow staff too (mirror of public.is_staff_member()).
    IF NOT public.is_staff_member() THEN
      RAISE EXCEPTION 'production_delete_v1: caller is not the director (or staff)';
    END IF;
  END IF;

  -- Cancel any linked reservation that isn't already cancelled/returned.
  FOR v_reservation_id IN
    SELECT id
      FROM public.reservations_new
     WHERE production_id = p_production_id
       AND status NOT IN ('בוטל','מוחזר','הוחזר')
  LOOP
    PERFORM public.update_reservation_status_v1(v_reservation_id, 'בוטל', NULL);
    v_cancelled_ids := array_append(v_cancelled_ids, v_reservation_id);
  END LOOP;

  -- Hard-delete the production. Cascades production_dates + production_crew.
  -- reservations_new.production_id is set to NULL via FK ON DELETE SET NULL,
  -- preserving the cancelled rows.
  DELETE FROM public.productions WHERE id = p_production_id;

  INSERT INTO public.activity_logs (
    user_id, user_name, action, entity, entity_id, details
  ) VALUES (
    COALESCE(v_jwt_email, 'system'), COALESCE(v_jwt_email, 'system'),
    'production_deleted', 'production', p_production_id,
    jsonb_build_object(
      'cancelled_reservation_ids', v_cancelled_ids,
      'director_email',            v_director_em
    )
  );

  RETURN jsonb_build_object(
    'ok',                       true,
    'production_id',            p_production_id,
    'cancelled_reservation_ids', v_cancelled_ids
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_delete_v1(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_delete_v1(text) TO authenticated, service_role;
