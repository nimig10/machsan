-- Student-side reservation item modification
--
-- Lets a student remove items from their own pending/approved equipment loan
-- request via the public form. Server-side validation enforces:
--   1. Ownership — reservation.email matches the caller's auth email
--   2. Status — only 'ממתין' or 'מאושר' are editable; everything else rejected
--   3. Action — 'decrement' | 'remove' | 'cancel_reservation' (no add)
--
-- Inventory: when status is 'מאושר' (and overlap with NOW window), removing
-- items frees `equipment.available_units`. Recomputed inline using the same
-- formula as create_reservation_v2 / update_reservation_status_v1.
--
-- Note on types: reservations_new.id, reservation_items.reservation_id, and
-- reservation_items.equipment_id are all TEXT (data was migrated from the old
-- store-blob world where IDs were JS-millisecond strings like
-- "1774106383032.451"). Only reservation_items.id is BIGINT (BIGSERIAL).
--
-- Race protection: SELECT … FOR UPDATE on the reservation row serializes
-- concurrent calls (student double-clicks, admin status change mid-flight).
--
-- PROTOCOL:
--   RPC: student_modify_reservation_item_v1(
--          p_reservation_id TEXT,
--          p_item_id        BIGINT,
--          p_action         TEXT,    -- 'decrement' | 'remove' | 'cancel_reservation'
--          p_actor_email    TEXT
--        )
--   Returns JSONB: { ok, reservation_id, action, items_count, new_status, equipment_ids }

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
    UPDATE public.reservations_new
       SET status = 'בוטל'
     WHERE id = p_reservation_id;
    v_new_status := 'בוטל';
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

  SELECT COUNT(*) INTO v_item_count_after
    FROM public.reservation_items
   WHERE reservation_id = p_reservation_id;

  INSERT INTO public.activity_logs (user_name, action, entity, entity_id, details)
  VALUES (
    p_actor_email,
    CASE p_action
      WHEN 'decrement'          THEN 'student_decrement_item'
      WHEN 'remove'             THEN 'student_remove_item'
      WHEN 'cancel_reservation' THEN 'student_cancel_reservation'
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
