-- Productions board — atomic hard-delete of a production and its linked reservations.
--
-- BEFORE THIS MIGRATION:
--   `production_delete_v1` (from 20260515110900) CANCELLED linked reservations
--   (status -> 'בוטל') and PR #18 then added api/delete-production.js to do a
--   non-atomic hard-delete via REST: loop delete_reservation_v1 per row, then
--   DELETE the production. If step 2 failed after step 1, reservations were
--   gone but the production stayed — no transaction, no rollback.
--
-- AFTER THIS MIGRATION:
--   `production_delete_v1` HARD-DELETES linked reservations atomically inside
--   a single Postgres transaction. Any RAISE EXCEPTION / FK violation rolls
--   back ALL row deletes, including the production itself. Zero risk of
--   orphan reservations or half-deleted state.
--
-- NO CALLERS BREAK:
--   Before this migration, `production_delete_v1` had ZERO callers in src/
--   or api/ (PR #18's api/delete-production.js bypassed it entirely). Safe to
--   CREATE OR REPLACE.
--
-- ACTIVITY LOG SHAPE:
--   details.deleted_reservation_ids (was: cancelled_reservation_ids)
--   Historical rows with the old key remain valid — no reader code consumes
--   this column structurally.

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
  v_deleted_ids     text[] := ARRAY[]::text[];
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
    IF NOT public.is_staff_member() THEN
      RAISE EXCEPTION 'production_delete_v1: caller is not the director (or staff)';
    END IF;
  END IF;

  -- Hard-delete every linked reservation (any status). Each call to
  -- delete_reservation_v1 removes reservation_items + reservations_new row
  -- and recomputes equipment.available_units. All deletes run in the
  -- current transaction; an exception in any one rolls back everything.
  FOR v_reservation_id IN
    SELECT id
      FROM public.reservations_new
     WHERE production_id = p_production_id
  LOOP
    PERFORM public.delete_reservation_v1(v_reservation_id);
    v_deleted_ids := array_append(v_deleted_ids, v_reservation_id);
  END LOOP;

  -- Hard-delete the production. Cascades production_dates + production_crew.
  -- (production_slots also CASCADE per 20260516180000.)
  DELETE FROM public.productions WHERE id = p_production_id;

  INSERT INTO public.activity_logs (
    user_id, user_name, action, entity, entity_id, details
  ) VALUES (
    COALESCE(v_jwt_email, 'system'), COALESCE(v_jwt_email, 'system'),
    'production_deleted', 'production', p_production_id,
    jsonb_build_object(
      'deleted_reservation_ids', v_deleted_ids,
      'director_email',          v_director_em
    )
  );

  RETURN jsonb_build_object(
    'ok',                     true,
    'production_id',          p_production_id,
    'deleted_reservation_ids', v_deleted_ids
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_delete_v1(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_delete_v1(text) TO authenticated, service_role;
