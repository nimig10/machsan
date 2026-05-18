-- Two new overlap guards (2026-05-18):
--   1. create_reservation_v2 — same student (lower(email)) cannot have two
--      active equipment-loan reservations at overlapping times.
--      Active = status NOT IN ('בוטל','הוחזר','נדחה').
--   2. Director-level production overlap — same director_student_id cannot
--      have two published productions whose shoot dates overlap.

-- 1) update create_reservation_v2

CREATE OR REPLACE FUNCTION public.create_reservation_v2(p_reservation jsonb, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation_id TEXT;
  v_item           JSONB;
  v_equipment_id   TEXT;
  v_quantity       INTEGER;
  v_healthy_count  INTEGER;
  v_reserved_count INTEGER;
  v_available      INTEGER;
  v_equipment_name TEXT;
  v_borrow_date    DATE;
  v_return_date    DATE;
  v_borrow_time    TIME;
  v_return_time    TIME;
  v_new_start      TIMESTAMPTZ;
  v_new_end        TIMESTAMPTZ;
  v_equipment_ids  TEXT[] := ARRAY[]::TEXT[];
  v_email_lc       TEXT;
  v_student_dup    RECORD;
BEGIN
  IF p_reservation IS NULL OR p_items IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: p_reservation and p_items are required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_reservation_v2: p_items must contain at least one item';
  END IF;

  v_borrow_date := NULLIF(p_reservation->>'borrow_date','')::DATE;
  v_return_date := NULLIF(p_reservation->>'return_date','')::DATE;
  IF v_borrow_date IS NULL OR v_return_date IS NULL THEN
    RAISE EXCEPTION 'create_reservation_v2: borrow_date and return_date are required';
  END IF;
  IF v_return_date < v_borrow_date THEN
    RAISE EXCEPTION 'create_reservation_v2: return_date (%) is before borrow_date (%)',
                    v_return_date, v_borrow_date;
  END IF;

  v_borrow_time := COALESCE(NULLIF(p_reservation->>'borrow_time','')::TIME, '00:00'::TIME);
  v_return_time := COALESCE(NULLIF(p_reservation->>'return_time','')::TIME, '23:59'::TIME);
  v_new_start := (v_borrow_date + v_borrow_time) AT TIME ZONE 'Asia/Jerusalem';
  v_new_end   := (v_return_date + v_return_time) AT TIME ZONE 'Asia/Jerusalem';

  -- ── Per-student overlap guard (added 2026-05-18) ──
  -- Same student (matched by email, case-insensitive) cannot have two active
  -- equipment-loan reservations overlapping in time. "Active" excludes the
  -- explicit dead statuses (cancelled/rejected/returned).
  v_email_lc := lower(trim(COALESCE(p_reservation->>'email','')));
  IF v_email_lc <> '' THEN
    SELECT r.id, r.project_name, r.borrow_date, r.return_date,
           r.borrow_time, r.return_time, r.loan_type, r.status
      INTO v_student_dup
      FROM public.reservations_new r
      WHERE lower(r.email) = v_email_lc
        AND r.status NOT IN ('בוטל','הוחזר','נדחה')
        AND r.borrow_date IS NOT NULL
        AND r.return_date IS NOT NULL
        AND tstzrange(
              (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                AT TIME ZONE 'Asia/Jerusalem',
              (r.return_date + COALESCE(NULLIF(r.return_time,'')::TIME, '23:59'::TIME))
                AT TIME ZONE 'Asia/Jerusalem',
              '[)'
            ) && tstzrange(v_new_start, v_new_end, '[)')
      LIMIT 1;
    IF v_student_dup.id IS NOT NULL THEN
      RAISE EXCEPTION 'create_reservation_v2: same student already has an active loan reservation overlapping these dates (id=%, project="%", %–%, status=%)',
        v_student_dup.id, v_student_dup.project_name, v_student_dup.borrow_date, v_student_dup.return_date, v_student_dup.status;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'equipment_id') IS NULL THEN
      RAISE EXCEPTION 'create_reservation_v2: item missing equipment_id (%)', v_item;
    END IF;
    IF COALESCE((v_item->>'quantity')::INTEGER, 1) <= 0 THEN
      RAISE EXCEPTION 'create_reservation_v2: quantity must be > 0';
    END IF;
  END LOOP;

  FOR v_equipment_id, v_quantity IN
    SELECT
      (it->>'equipment_id')::TEXT                               AS equipment_id,
      SUM(COALESCE((it->>'quantity')::INTEGER, 1))::INTEGER     AS total_qty
    FROM jsonb_array_elements(p_items) AS it
    GROUP BY (it->>'equipment_id')::TEXT
  LOOP
    SELECT name INTO v_equipment_name
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_reservation_v2: equipment % not found', v_equipment_id;
    END IF;

    SELECT COUNT(*) INTO v_healthy_count
      FROM public.equipment_units
      WHERE equipment_id = v_equipment_id
        AND status = 'תקין';

    SELECT COALESCE(SUM(ri.quantity), 0) INTO v_reserved_count
      FROM public.reservation_items ri
      JOIN public.reservations_new r ON r.id = ri.reservation_id
      WHERE ri.equipment_id = v_equipment_id
        AND r.status IN ('מאושר','באיחור','פעילה')
        AND r.borrow_date IS NOT NULL
        AND r.return_date IS NOT NULL
        AND tstzrange(
              (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                AT TIME ZONE 'Asia/Jerusalem',
              (r.return_date + COALESCE(NULLIF(r.return_time,'')::TIME, '23:59'::TIME))
                AT TIME ZONE 'Asia/Jerusalem',
              '[)'
            ) && tstzrange(v_new_start, v_new_end, '[)');

    v_available := v_healthy_count - v_reserved_count;
    IF v_available < v_quantity THEN
      RAISE EXCEPTION 'create_reservation_v2: not enough units for "%" (id=%) — requested %, available % (healthy=%, reserved=%)',
                      v_equipment_name, v_equipment_id, v_quantity, v_available, v_healthy_count, v_reserved_count;
    END IF;

    v_equipment_ids := array_append(v_equipment_ids, v_equipment_id);
  END LOOP;

  v_reservation_id := COALESCE(
    p_reservation->>'id',
    (EXTRACT(EPOCH FROM NOW()) * 1000)::TEXT
  );

  INSERT INTO public.reservations_new (
    id, email, phone, student_name, course, status, loan_type, project_name,
    borrow_date, borrow_time, return_date, return_time,
    created_at, submitted_at,
    sound_day_loan, sound_night_loan,
    crew_sound_name, crew_sound_phone,
    crew_photographer_name, crew_photographer_phone,
    studio_booking_id, lesson_id, booking_kind, lesson_auto, lesson_kit_id,
    production_id, production_date_id
  ) VALUES (
    v_reservation_id,
    p_reservation->>'email', p_reservation->>'phone', p_reservation->>'student_name',
    p_reservation->>'course', COALESCE(p_reservation->>'status','ממתין'),
    p_reservation->>'loan_type', p_reservation->>'project_name',
    v_borrow_date, p_reservation->>'borrow_time',
    v_return_date, p_reservation->>'return_time',
    COALESCE(NULLIF(p_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
    NULLIF(p_reservation->>'submitted_at','')::TIMESTAMPTZ,
    COALESCE((p_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
    COALESCE((p_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
    p_reservation->>'crew_sound_name', p_reservation->>'crew_sound_phone',
    p_reservation->>'crew_photographer_name', p_reservation->>'crew_photographer_phone',
    NULLIF(p_reservation->>'studio_booking_id','')::TEXT,
    NULLIF(p_reservation->>'lesson_id','')::TEXT,
    p_reservation->>'booking_kind',
    COALESCE((p_reservation->>'lesson_auto')::BOOLEAN, FALSE),
    NULLIF(p_reservation->>'lesson_kit_id','')::TEXT,
    NULLIF(p_reservation->>'production_id','')::TEXT,
    NULLIF(p_reservation->>'production_date_id','')::TEXT
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
  END LOOP;

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

-- 2) Director-overlap guard on productions

CREATE OR REPLACE FUNCTION public.check_director_no_overlap_for_production(p_production_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_director_id text;
  v_status      text;
  v_conflict    record;
BEGIN
  SELECT director_student_id, status INTO v_director_id, v_status
  FROM public.productions WHERE id = p_production_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status <> 'published' THEN RETURN; END IF;
  IF v_director_id IS NULL OR v_director_id = '' THEN RETURN; END IF;

  SELECT p2.id, p2.title, pd2.start_date, pd2.end_date
    INTO v_conflict
    FROM public.production_dates pd1
    JOIN public.production_dates pd2 ON pd2.production_id <> pd1.production_id
    JOIN public.productions p2 ON p2.id = pd2.production_id
   WHERE pd1.production_id = p_production_id
     AND p2.status = 'published'
     AND p2.director_student_id = v_director_id
     AND daterange(pd1.start_date, pd1.end_date, '[]')
         && daterange(pd2.start_date, pd2.end_date, '[]')
   LIMIT 1;

  IF v_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'הבמאי כבר ראש הפקה אחרת בתאריכים חופפים: "%" (% – %)',
      v_conflict.title, v_conflict.start_date, v_conflict.end_date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.production_dates_director_overlap_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.check_director_no_overlap_for_production(NEW.production_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_dates_director_overlap_trg ON public.production_dates;
CREATE CONSTRAINT TRIGGER production_dates_director_overlap_trg
AFTER INSERT OR UPDATE OF start_date, end_date, production_id ON public.production_dates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.production_dates_director_overlap_trg();

CREATE OR REPLACE FUNCTION public.productions_status_director_overlap_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    PERFORM public.check_director_no_overlap_for_production(NEW.id);
  END IF;
  IF NEW.status = 'published'
     AND NEW.director_student_id IS DISTINCT FROM COALESCE(OLD.director_student_id, '') THEN
    PERFORM public.check_director_no_overlap_for_production(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS productions_director_overlap_trg ON public.productions;
CREATE CONSTRAINT TRIGGER productions_director_overlap_trg
AFTER INSERT OR UPDATE OF status, director_student_id ON public.productions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.productions_status_director_overlap_trg();
