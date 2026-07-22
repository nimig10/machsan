-- Focused regression tests for the no-replace v3 boundary.

CREATE OR REPLACE FUNCTION public.run_reservation_update_v3_tests()
RETURNS TABLE(scenario text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r_replace text := 'test-upd-v3-replace';
  r_cutoff text := 'test-upd-v3-cutoff';
  r_auto_then_approved text := 'test-upd-v3-auto-then-approved';
  s_email text := 'upd-v3-test@smoke.dev';
  eq_old text := 'test-upd-v3-old';
  eq_new text := 'test-upd-v3-new';
  old_item bigint;
  actual_error text;
BEGIN
  DELETE FROM public.reservations_new WHERE id LIKE 'test-upd-v3-%';
  DELETE FROM public.equipment WHERE id LIKE 'test-upd-v3-%';

  INSERT INTO public.equipment (id, name, category, total_quantity) VALUES
    (eq_old, 'ציוד ישן v3', 'טסט', 2),
    (eq_new, 'ציוד חדש v3', 'טסט', 2);
  INSERT INTO public.equipment_units (id, equipment_id, status)
  SELECT eq_old || '_' || g, eq_old, 'תקין' FROM generate_series(1, 2) g;
  INSERT INTO public.equipment_units (id, equipment_id, status)
  SELECT eq_new || '_' || g, eq_new, 'תקין' FROM generate_series(1, 2) g;

  INSERT INTO public.reservations_new
    (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_replace, s_email, 'טסט', 'ממתין', 'פרטית', current_date + 5, '09:00', current_date + 6, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
  VALUES (r_replace, eq_old, 'ציוד ישן v3', 1) RETURNING id INTO old_item;

  BEGIN
    PERFORM public.student_submit_reservation_update_v3(r_replace, s_email,
      jsonb_build_array(jsonb_build_object('action', 'replace', 'item_id', old_item, 'equipment_id', eq_new, 'quantity', 1)));
    actual_error := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    actual_error := CASE WHEN position('invalid_ops' IN SQLERRM) > 0 THEN 'invalid_ops' ELSE SQLERRM END;
  END;
  RETURN QUERY SELECT 'replace is rejected at the DB boundary', 'invalid_ops', actual_error, actual_error = 'invalid_ops';

  INSERT INTO public.reservations_new
    (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_cutoff, s_email, 'טסט', 'ממתין', 'סאונד',
    ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '1 hour')::date,
    to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '1 hour', 'HH24:MI'),
    (now() AT TIME ZONE 'Asia/Jerusalem')::date + 1, '17:00');
  BEGIN
    PERFORM public.student_submit_reservation_update_v3(r_cutoff, s_email,
      jsonb_build_array(jsonb_build_object('action', 'add', 'equipment_id', eq_new, 'quantity', 1)));
    actual_error := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    actual_error := CASE WHEN position('lead_time' IN SQLERRM) > 0 THEN 'lead_time' ELSE SQLERRM END;
  END;
  RETURN QUERY SELECT 'DB blocks direct update after lead-time cutoff', 'lead_time', actual_error, actual_error = 'lead_time';

  -- An update sent before approval is auto-applied and still consumes one of
  -- the two student updates. Once the reservation itself becomes approved,
  -- the remaining update must be allowed and sent to warehouse review.
  INSERT INTO public.reservations_new
    (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_auto_then_approved, s_email, 'טסט', 'ממתין', 'סאונד', current_date + 5, '09:00', current_date + 6, '17:00');
  PERFORM public.student_submit_reservation_update_v3(r_auto_then_approved, s_email,
    jsonb_build_array(jsonb_build_object('action', 'add', 'equipment_id', eq_old, 'quantity', 1)));
  UPDATE public.reservations_new SET status = 'מאושר' WHERE id = r_auto_then_approved;
  BEGIN
    IF (public.student_submit_reservation_update_v3(r_auto_then_approved, s_email,
      jsonb_build_array(jsonb_build_object('action', 'add', 'equipment_id', eq_new, 'quantity', 1)))->>'mode') = 'pending' THEN
      actual_error := 'pending';
    ELSE
      actual_error := 'unexpected_mode';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    actual_error := SQLERRM;
  END;
  RETURN QUERY SELECT 'auto-applied update still allows one approved-status update', 'pending', actual_error, actual_error = 'pending';

  DELETE FROM public.reservations_new WHERE id LIKE 'test-upd-v3-%';
  DELETE FROM public.equipment WHERE id LIKE 'test-upd-v3-%';
END;
$function$;

REVOKE ALL ON FUNCTION public.run_reservation_update_v3_tests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_reservation_update_v3_tests() TO service_role;
