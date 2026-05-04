-- restore_reservation_v1 RPC
--
-- Used by the admin "↩ בטל פעולה" (undo) button to recreate a
-- reservation that was just deleted. Differs from create_reservation_v2
-- in two ways:
--
-- 1. Skips the overlap / availability check. The row being restored
--    was valid when it existed; if a competing reservation snuck into
--    the same window during the brief delete-undo round-trip, we still
--    want the original back — staff can re-resolve the overlap manually.
--
-- 2. Idempotent: if a row with the same id already exists, returns
--    silently (without raising). Lets the caller hit it once per
--    candidate without first checking existence.
--
-- Same INSERT shape as create_reservation_v2 + same available_units
-- recompute at the end. The undo code path passes the original full
-- reservation row + items, so we're literally re-INSERTing what was
-- there.

CREATE OR REPLACE FUNCTION public.restore_reservation_v1(p_reservation jsonb, p_items jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation_id TEXT;
  v_item           JSONB;
  v_borrow_date    DATE;
  v_return_date    DATE;
  v_equipment_ids  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_reservation IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'restore_reservation_v1: p_reservation and p_items are required';
  END IF;

  v_reservation_id := COALESCE(
    p_reservation->>'id',
    (EXTRACT(EPOCH FROM NOW()) * 1000)::TEXT
  );

  -- Idempotent: if it already exists, just return its id and don't error.
  IF EXISTS (SELECT 1 FROM public.reservations_new WHERE id = v_reservation_id) THEN
    RETURN v_reservation_id;
  END IF;

  v_borrow_date := NULLIF(p_reservation->>'borrow_date','')::DATE;
  v_return_date := NULLIF(p_reservation->>'return_date','')::DATE;
  IF v_borrow_date IS NULL OR v_return_date IS NULL THEN
    RAISE EXCEPTION 'restore_reservation_v1: borrow_date and return_date are required';
  END IF;

  INSERT INTO public.reservations_new (
    id, email, phone, student_name, course, status, loan_type, project_name,
    borrow_date, borrow_time, return_date, return_time,
    created_at, submitted_at, returned_at,
    sound_day_loan, sound_night_loan,
    crew_sound_name, crew_sound_phone,
    crew_photographer_name, crew_photographer_phone,
    studio_booking_id, lesson_id, booking_kind, lesson_auto, lesson_kit_id,
    lecturer_notes, overdue_notified
  ) VALUES (
    v_reservation_id,
    p_reservation->>'email', p_reservation->>'phone', p_reservation->>'student_name',
    p_reservation->>'course', COALESCE(p_reservation->>'status','ממתין'),
    p_reservation->>'loan_type', p_reservation->>'project_name',
    v_borrow_date, p_reservation->>'borrow_time',
    v_return_date, p_reservation->>'return_time',
    COALESCE(NULLIF(p_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
    NULLIF(p_reservation->>'submitted_at','')::TIMESTAMPTZ,
    NULLIF(p_reservation->>'returned_at','')::TIMESTAMPTZ,
    COALESCE((p_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
    COALESCE((p_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
    p_reservation->>'crew_sound_name', p_reservation->>'crew_sound_phone',
    p_reservation->>'crew_photographer_name', p_reservation->>'crew_photographer_phone',
    NULLIF(p_reservation->>'studio_booking_id','')::TEXT,
    NULLIF(p_reservation->>'lesson_id','')::TEXT,
    p_reservation->>'booking_kind',
    COALESCE((p_reservation->>'lesson_auto')::BOOLEAN, FALSE),
    NULLIF(p_reservation->>'lesson_kit_id','')::TEXT,
    NULLIF(p_reservation->>'lecturer_notes',''),
    COALESCE((p_reservation->>'overdue_notified')::BOOLEAN, FALSE)
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity, unit_id)
    VALUES (
      v_reservation_id,
      (v_item->>'equipment_id')::TEXT,
      v_item->>'name',
      COALESCE((v_item->>'quantity')::INTEGER, 1),
      v_item->>'unit_id'
    );
    v_equipment_ids := array_append(v_equipment_ids, (v_item->>'equipment_id')::TEXT);
  END LOOP;

  -- Recompute available_units for touched equipment so the cached counter
  -- reflects the just-restored row. Same formula as create_reservation_v2.
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

  RETURN v_reservation_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.restore_reservation_v1(jsonb, jsonb) TO service_role;
