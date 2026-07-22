-- Product decision (2026-07-22, supersedes the note in HANDOFF-D): the UPDATE
-- window for פרטית and קולנוע יומית is an exact 24-hour clock against the
-- pickup moment — not the calendar-day approximation used until now.
--
-- The published policy for both types is "התראה מוקדמת: 24 שעות", and staff
-- want it read literally: a loan collected at 14:30 stops accepting item
-- additions at 14:30 the previous day, not at 23:59 of that day.
--
-- סאונד keeps its 3-hour rule. הפקה keeps the weekday-rolled calendar rule
-- (7-day gap). Item REMOVAL is unaffected — it was never lead-time gated.
--
-- Mirrors src/utils/loanPolicy.js (hourlyUpdateLeadMs), which is the shared
-- client+API source. Both must stay in agreement; this function is the
-- authoritative gate because it runs under the reservation row lock.
--
-- Byte-for-byte identical to 20260722153000's v3 except the lead-time block.

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
  v_borrow_ts timestamptz;
  v_lead interval;
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

  v_borrow_ts := (v_borrow_date + coalesce(nullif(v_borrow_time, '')::time, '00:00'::time))
                   AT TIME ZONE 'Asia/Jerusalem';

  -- Hour-precise types: סאונד 3h · פרטית / קולנוע יומית 24h.
  IF v_loan_type IN ('סאונד', 'פרטית', 'קולנוע יומית') THEN
    v_lead := CASE WHEN v_loan_type = 'סאונד'
                   THEN interval '3 hours'
                   ELSE interval '24 hours' END;
    IF v_borrow_ts < now() + v_lead THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v3: lead_time — less than % remain before pickup', v_lead;
    END IF;
  ELSE
    -- הפקה (and any unrecognised type): weekday-rolled calendar rule, unchanged.
    v_min_date := (now() AT TIME ZONE 'Asia/Jerusalem')::date + 7;
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
