-- 20260813120100_student_modify_block_after_issue.sql
--
-- Close the hole that 20260813120000 exposes.
--
-- student_modify_reservation_item_v1 gates on status alone:
--
--   IF v_status NOT IN ('ממתין', 'אישור ראש מחלקה', 'מאושר') THEN ... not editable
--
-- and has NO time check anywhere. That was never noticed because a second,
-- accidental gate stood in front of it: PublicForm renders the remove / cancel
-- buttons only while getEffectiveStatus(r) is one of those three, and that
-- function flipped a row to "פעילה" the moment borrow_date+borrow_time passed.
-- So the DB has always been willing to let a student delete items from — or
-- cancel outright — a loan whose gear is already in their bag; the buttons just
-- were not on screen.
--
-- 20260813120000 deletes that derivation, and a status-only gate then leaves
-- the row sitting at 'מאושר' for as long as the gear is out. What was hidden
-- becomes a button. Hiding it again in the client would rebuild exactly the
-- accidental arrangement that got us here, so the gate goes where it belongs.
--
-- Note which sibling RPC is NOT touched: student_submit_reservation_update_v1
-- already refuses once pickup time has arrived ("already_started", check 3), so
-- ADDING items is covered. This RPC is the one that removes and cancels, and
-- those are deliberately NOT time-limited — a student may always give gear back
-- or drop a request. "Always" has to stop at the moment the gear leaves.
--
-- Body is otherwise byte-identical to 20260518140000, including the
-- available_units recompute (which still mirrors the OLD getEffectiveStatus).
-- That mirror is now over-conservative rather than wrong: it counts a 'מאושר'
-- row whose pickup passed as if the gear were out, which it may not be. The
-- column is read by nothing in src/ and by no guard — availability is computed
-- live — so narrowing it is a separate, riskier change and is deliberately not
-- bundled here.
--
-- CREATE OR REPLACE, same signature, no DROP: the function is granted to
-- anon/authenticated and dropping it would revoke that mid-flight.

CREATE OR REPLACE FUNCTION public.student_modify_reservation_item_v1(p_reservation_id text, p_item_id bigint, p_action text, p_actor_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email             TEXT;
  v_status            TEXT;
  v_issued_at         TIMESTAMPTZ;
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

  SELECT email, status, issued_at
    INTO v_email, v_status, v_issued_at
    FROM public.reservations_new
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: reservation % not found', p_reservation_id;
  END IF;

  IF LOWER(COALESCE(v_email, '')) <> LOWER(p_actor_email) THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: forbidden (not owner)';
  END IF;

  IF v_status NOT IN ('ממתין', 'אישור ראש מחלקה', 'מאושר') THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: reservation status % is not editable', v_status;
  END IF;

  -- The gear has physically left the warehouse. Same error token as the status
  -- check above on purpose: /not editable/i is what the endpoint already maps
  -- to 409 status_not_editable, so no API change is needed.
  IF v_issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'student_modify_reservation_item_v1: reservation % is not editable — equipment was already issued', p_reservation_id;
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
      RAISE EXCEPTION 'student_modify_reservation_item_v1: cannot decrement item % below 1 - use remove instead', p_item_id;
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
