-- Student cancel-reservation: hard delete instead of status change.
--
-- The original RPC (20260511160000) set status='בוטל' on cancel_reservation —
-- but the reservation row stayed in reservations_new and kept appearing in the
-- admin warehouse view. Per product decision (2026-05-12), a student cancel
-- must remove the request from the system entirely; only the activity_log
-- audit row survives.
--
-- Same RPC signature and external contract — decrement/remove unchanged.
-- Only the cancel_reservation branch swaps UPDATE → DELETE. The
-- ON DELETE CASCADE on reservation_items.reservation_id (migration
-- 20260415000003) cleans up children automatically. The available_units
-- recompute that follows the action block still works because we collected
-- v_equipment_ids BEFORE the delete.

CREATE OR REPLACE FUNCTION public.student_modify_reservation_item_v1(
  p_reservation_id TEXT,
  p_item_id        BIGINT,
  p_action         TEXT,
  p_actor_email    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email             TEXT;
  v_status            TEXT;
  v_new_status        TEXT;
  v_item_eq_id        TEXT;
  v_item_quantity     INTEGER;
  v_item_count_after  INTEGER;
  v_equipment_ids     TEXT[] := ARRAY[]::TEXT[];
  v_item_count_before INTEGER;
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: p_reservation_id is required';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('decrement', 'remove', 'cancel_reservation') THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: invalid action %', p_action;
  END IF;
  IF p_actor_email IS NULL OR p_actor_email = '' THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: p_actor_email is required';
  END IF;

  SELECT email, status
    INTO v_email, v_status
    FROM public.reservations_new
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: reservation % not found', p_reservation_id;
  END IF;

  IF LOWER(COALESCE(v_email, '')) <> LOWER(p_actor_email) THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: forbidden (not owner)';
  END IF;

  IF v_status NOT IN ('ממתין', 'מאושר') THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: reservation status % is not editable (must be ממתין or מאושר)', v_status;
  END IF;

  IF p_action IN ('decrement', 'remove') THEN
    SELECT equipment_id, quantity
      INTO v_item_eq_id, v_item_quantity
      FROM public.reservation_items
     WHERE id = p_item_id
       AND reservation_id = p_reservation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'student_modify_reservation_item_v1: item % not found on reservation %', p_item_id, p_reservation_id;
    END IF;
    IF v_item_eq_id IS NOT NULL THEN
      v_equipment_ids := array_append(v_equipment_ids, v_item_eq_id);
    END IF;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT equipment_id) FILTER (WHERE equipment_id IS NOT NULL), ARRAY[]::TEXT[])
      INTO v_equipment_ids
      FROM public.reservation_items
     WHERE reservation_id = p_reservation_id;
  END IF;

  IF p_action = 'decrement' THEN
    IF v_item_quantity <= 1 THEN
      RAISE EXCEPTION 'student_modify_reservation_item_v1: cannot decrement item % below 1 — use remove instead', p_item_id;
    END IF;
    UPDATE public.reservation_items
       SET quantity = quantity - 1
     WHERE id = p_item_id
       AND reservation_id = p_reservation_id;
    v_new_status := v_status;

  ELSIF p_action = 'remove' THEN
    DELETE FROM public.reservation_items
     WHERE id = p_item_id
       AND reservation_id = p_reservation_id;
    v_new_status := v_status;

  ELSIF p_action = 'cancel_reservation' THEN
    -- Log BEFORE delete so the audit row survives. entity_id is just TEXT,
    -- no FK back to reservations_new — safe to keep after the parent vanishes.
    SELECT COUNT(*) INTO v_item_count_before
      FROM public.reservation_items
     WHERE reservation_id = p_reservation_id;

    INSERT INTO public.activity_logs (user_name, action, entity, entity_id, details)
    VALUES (
      p_actor_email,
      'student_cancel_reservation',
      'reservation',
      p_reservation_id,
      jsonb_build_object(
        'status_before',     v_status,
        'status_after',      'deleted',
        'item_count_before', v_item_count_before,
        'equipment_ids',     to_jsonb(v_equipment_ids)
      )
    );

    -- Hard delete — reservation_items cascade via FK ON DELETE CASCADE
    DELETE FROM public.reservations_new WHERE id = p_reservation_id;
    v_new_status := 'deleted';
  END IF;

  IF array_length(v_equipment_ids, 1) > 0 THEN
    UPDATE public.equipment eq
       SET available_units = GREATEST(
             (
               SELECT COUNT(*)
                 FROM public.equipment_units u
                WHERE u.equipment_id = eq.id
                  AND u.status = 'תקין'
             )
             - COALESCE(
               (
                 SELECT SUM(ri.quantity)
                   FROM public.reservation_items ri
                   JOIN public.reservations_new r ON r.id = ri.reservation_id
                  WHERE ri.equipment_id = eq.id
                    AND (
                      r.status IN ('באיחור', 'פעילה')
                      OR (
                        r.status = 'מאושר'
                        AND r.borrow_date IS NOT NULL
                        AND (
                          r.borrow_date
                          + COALESCE(NULLIF(r.borrow_time, '')::TIME, '00:00'::TIME)
                        ) <= (NOW() AT TIME ZONE 'Asia/Jerusalem')
                      )
                    )
               ), 0
             ),
             0
           ),
           updated_at = NOW()
     WHERE eq.id = ANY(v_equipment_ids);
  END IF;

  IF p_action = 'cancel_reservation' THEN
    v_item_count_after := 0;
  ELSE
    SELECT COUNT(*) INTO v_item_count_after
      FROM public.reservation_items
     WHERE reservation_id = p_reservation_id;

    -- Per-item actions still log here; cancel_reservation logged above
    INSERT INTO public.activity_logs (user_name, action, entity, entity_id, details)
    VALUES (
      p_actor_email,
      CASE p_action
        WHEN 'decrement' THEN 'student_decrement_item'
        WHEN 'remove'    THEN 'student_remove_item'
      END,
      'reservation',
      p_reservation_id,
      jsonb_build_object(
        'item_id',        p_item_id,
        'equipment_id',   v_item_eq_id,
        'status_before',  v_status,
        'status_after',   v_new_status,
        'items_after',    v_item_count_after
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'reservation_id', p_reservation_id,
    'action',         p_action,
    'items_count',    v_item_count_after,
    'new_status',     v_new_status,
    'equipment_ids',  to_jsonb(v_equipment_ids)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.student_modify_reservation_item_v1(TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;
