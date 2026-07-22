-- Product decision: student updates support add / quantity increase only.
-- A student who wants different equipment removes the old item and adds a new
-- one; there is no atomic "replace" operation anywhere in the application.

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reservation_pending_items WHERE action = 'replace') THEN
    RAISE EXCEPTION 'Cannot retire replace: existing reservation_pending_items rows still use action=replace';
  END IF;
END;
$block$;

ALTER TABLE public.reservation_pending_items
  DROP CONSTRAINT IF EXISTS reservation_pending_items_action_check;

ALTER TABLE public.reservation_pending_items
  ADD CONSTRAINT reservation_pending_items_action_check
  CHECK (action IN ('add', 'increase'));

DROP FUNCTION IF EXISTS public.student_submit_reservation_update_v2(text, text, jsonb);
DROP FUNCTION IF EXISTS public.staff_review_reservation_update_v2(bigint, uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public.run_reservation_update_v2_tests();

-- Keeps the authoritative locked lead-time check while deliberately
-- delegating the add/increase semantics to the mature v1 implementation.
CREATE OR REPLACE FUNCTION public.student_submit_reservation_update_v3(
  p_reservation_id text,
  p_actor_email text,
  p_ops jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_loan_type text;
  v_borrow_date date;
  v_borrow_time text;
  v_min_date date;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v3: invalid_ops — p_ops must be a non-empty array';
  END IF;

  SELECT email, loan_type, borrow_date, borrow_time
    INTO v_email, v_loan_type, v_borrow_date, v_borrow_time
    FROM public.reservations_new
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v3: reservation % not found', p_reservation_id;
  END IF;
  IF lower(coalesce(v_email, '')) <> lower(coalesce(p_actor_email, '')) THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v3: forbidden (not owner)';
  END IF;
  IF v_borrow_date IS NULL THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v3: lead_time — missing borrow date';
  END IF;

  IF v_loan_type = 'סאונד' THEN
    IF (v_borrow_date + coalesce(nullif(v_borrow_time, '')::time, '00:00'::time))
         AT TIME ZONE 'Asia/Jerusalem' < now() + interval '3 hours' THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v3: lead_time — less than 3 hours remain';
    END IF;
  ELSE
    v_min_date := (now() AT TIME ZONE 'Asia/Jerusalem')::date
      + CASE WHEN v_loan_type IN ('פרטית', 'קולנוע יומית') THEN 1 ELSE 7 END;
    WHILE extract(dow FROM v_min_date) IN (5, 6) LOOP
      v_min_date := v_min_date + 1;
    END LOOP;
    IF v_borrow_date < v_min_date THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v3: lead_time — minimum borrow date is %', v_min_date;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_ops) op
    WHERE op->>'action' NOT IN ('add', 'increase')
       OR coalesce((op->>'quantity')::integer, 0) < 1
  ) THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v3: invalid_ops';
  END IF;

  RETURN public.student_submit_reservation_update_v1(p_reservation_id, p_actor_email, p_ops);
END;
$function$;

REVOKE ALL ON FUNCTION public.student_submit_reservation_update_v3(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_submit_reservation_update_v3(text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_reservation_update_v3(text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_review_reservation_update_v3(
  p_update_id bigint,
  p_actor_id uuid,
  p_actor_name text,
  p_decisions jsonb,
  p_staff_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.staff_review_reservation_update_v1(
    p_update_id, p_actor_id, p_actor_name, p_decisions, p_staff_message
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_review_reservation_update_v3(bigint, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_review_reservation_update_v3(bigint, uuid, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_review_reservation_update_v3(bigint, uuid, text, jsonb, text) TO service_role;
