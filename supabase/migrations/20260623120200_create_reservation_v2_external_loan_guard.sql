-- Add the external-loan restriction guard to create_reservation_v2.
--
-- For the two loan types that physically remove gear from campus —
-- 'פרטית' (private) and 'הפקה' (production) — enforce per item:
--   * external_loan_restricted = TRUE  → the item is BLOCKED entirely
--     (RAISE with stable token 'external_restricted').
--   * external_loan_hold_count = N     → reduce the available pool by N so the
--     reservation can never draw the held-back units (≥N stay on campus).
--
-- ⚠️ ANTI-REGRESSION: this re-declares create_reservation_v2 based BYTE-FOR-BYTE
-- on 20260613153000 (the current authoritative definition). All three existing
-- guards are PRESERVED unchanged:
--   1. per-student overlap guard (lower(email), all loan types, lessons ignored)
--   2. per-equipment availability guard (status IN ('מאושר','באיחור','פעילה'))
--   3. crew-snapshot derivation from approved production_crew
-- The ONLY additions are the three new DECLARE vars and the external-loan block
-- inserted between availability computation and the "not enough units" check.

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
  -- Per-student overlap guard (restored 2026-06-13).
  v_email_lc       TEXT;
  v_student_dup    RECORD;
  -- Crew snapshot, derived from the production when the payload is empty.
  v_production_id     TEXT;
  v_crew_photog_name  TEXT;
  v_crew_photog_phone TEXT;
  v_crew_sound_name   TEXT;
  v_crew_sound_phone  TEXT;
  -- External-loan restriction guard (added 2026-06-23).
  v_loan_type      TEXT;
  v_ext_restricted BOOLEAN;
  v_ext_hold       INTEGER;
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

  v_loan_type := p_reservation->>'loan_type';

  -- ── Per-student overlap guard (ALL loan types) ──────────────────────────
  -- Same student (lower(email)) may hold only ONE active loan request per time
  -- window. "Active" = status NOT IN dead set. Lessons are not loans → ignored.
  v_email_lc := lower(trim(COALESCE(p_reservation->>'email','')));
  IF v_email_lc <> '' THEN
    SELECT r.id, r.project_name, r.borrow_date, r.return_date,
           r.borrow_time, r.return_time, r.loan_type, r.status
      INTO v_student_dup
      FROM public.reservations_new r
      WHERE lower(r.email) = v_email_lc
        AND r.status NOT IN ('בוטל','הוחזר','נדחה')
        AND COALESCE(r.lesson_auto, false) = false
        AND r.loan_type IS DISTINCT FROM 'שיעור'
        AND r.id <> COALESCE(p_reservation->>'id','')
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
      RAISE EXCEPTION 'create_reservation_v2: student_overlap — same student already has an active loan reservation overlapping these dates (id=%, project="%", %–%, status=%)',
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
    SELECT name, external_loan_restricted, COALESCE(external_loan_hold_count, 0)
      INTO v_equipment_name, v_ext_restricted, v_ext_hold
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_reservation_v2: equipment % not found', v_equipment_id;
    END IF;

    SELECT COUNT(*) INTO v_healthy_count
      FROM public.equipment_units
      WHERE equipment_id = v_equipment_id
        AND status = 'תקין';

    -- ONLY actively-blocking statuses count against availability:
    --   מאושר  (approved by warehouse — committed)
    --   באיחור (overdue — gear still out)
    --   פעילה  (active — gear currently checked out)
    -- ממתין / אישור ראש מחלקה stay out of the count so they don't block other requests.
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

    -- ── External-loan restriction (private / production only) ──────────────
    -- These two loan types physically remove gear from campus. A fully
    -- restricted item is blocked outright; a hold-count reserves N units on
    -- campus by shrinking the available pool the request can draw from.
    IF v_loan_type IN ('פרטית','הפקה') THEN
      IF v_ext_restricted THEN
        RAISE EXCEPTION 'create_reservation_v2: external_restricted — "%" (id=%) is blocked from external loans',
                        v_equipment_name, v_equipment_id;
      END IF;
      v_available := GREATEST(0, v_available - v_ext_hold);
    END IF;

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

  -- Crew snapshot: take what the client sent, then fill any empty role from the
  -- production's approved crew (single source of truth). Phones come along so
  -- the warehouse name-match can disambiguate duplicate names if needed.
  v_production_id     := NULLIF(p_reservation->>'production_id','');
  v_crew_photog_name  := p_reservation->>'crew_photographer_name';
  v_crew_photog_phone := p_reservation->>'crew_photographer_phone';
  v_crew_sound_name   := p_reservation->>'crew_sound_name';
  v_crew_sound_phone  := p_reservation->>'crew_sound_phone';

  IF v_production_id IS NOT NULL THEN
    IF COALESCE(v_crew_photog_name,'') = '' THEN
      SELECT s.name, s.phone INTO v_crew_photog_name, v_crew_photog_phone
        FROM public.production_crew pc
        JOIN public.students s ON s.id = pc.student_id
       WHERE pc.production_id = v_production_id
         AND pc.role          = 'photographer'
         AND pc.status        = 'approved'
       LIMIT 1;
    END IF;
    IF COALESCE(v_crew_sound_name,'') = '' THEN
      SELECT s.name, s.phone INTO v_crew_sound_name, v_crew_sound_phone
        FROM public.production_crew pc
        JOIN public.students s ON s.id = pc.student_id
       WHERE pc.production_id = v_production_id
         AND pc.role          = 'sound'
         AND pc.status        = 'approved'
       LIMIT 1;
    END IF;
  END IF;

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
    v_crew_sound_name, v_crew_sound_phone,
    v_crew_photog_name, v_crew_photog_phone,
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
