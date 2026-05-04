-- Lecturer notes on reservations
--
-- The lecturer portal has a "הערות" textarea on both the per-session
-- editor ("השאלת מפגש") and the per-course editor ("השאלת קורס") for
-- the lecturer to leave a note for warehouse staff (e.g. "Need extra
-- gels for this session", "Bring boom pole stand"). Until now the
-- frontend sent the note as `description` to /api/lecturer-kit, which
-- forwarded it to the create_reservation_v2 / create_lesson_reservations_v1
-- RPCs as `notes` — but reservations_new has no `notes` column, so
-- the value was silently dropped on insert. Notes never reached staff.
--
-- Fix:
-- 1. Add reservations_new.lecturer_notes TEXT (NULL by default).
-- 2. Both RPCs read p_reservation->>'lecturer_notes' and INSERT it.
--
-- Backfill: none — historical lessons have no lecturer note recorded
-- anywhere (it was discarded), so all existing rows stay NULL.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS lecturer_notes TEXT;

COMMENT ON COLUMN public.reservations_new.lecturer_notes IS
'Free-text note from the lecturer to warehouse staff for this lesson loan. Set via the lecturer portal "הערות" textarea on session/course editors. NULL when no note was entered or for non-lesson loans.';


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
        AND r.status IN ('ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה')
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
    lecturer_notes
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
    NULLIF(p_reservation->>'lecturer_notes','')
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


CREATE OR REPLACE FUNCTION public.create_lesson_reservations_v1(p_kit_id text, p_reservations jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation      JSONB;
  v_item             JSONB;
  v_equipment_id     TEXT;
  v_quantity         INTEGER;
  v_equipment_name   TEXT;
  v_borrow_date      DATE;
  v_return_date      DATE;
  v_borrow_time      TIME;
  v_return_time      TIME;
  v_new_start        TIMESTAMPTZ;
  v_new_end          TIMESTAMPTZ;
  v_reservation_id   TEXT;
  v_deleted_count    INTEGER := 0;
  v_inserted_count   INTEGER := 0;
  v_inserted_ids     TEXT[]  := ARRAY[]::TEXT[];
  v_equipment_ids    TEXT[]  := ARRAY[]::TEXT[];
  v_healthy_count    INTEGER;
  v_reserved_count   INTEGER;
  v_available        INTEGER;
  v_session_index    INTEGER;
  v_session_label    TEXT;
BEGIN
  IF p_kit_id IS NULL OR p_kit_id = '' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_kit_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_items must be a JSONB array';
  END IF;
  IF p_reservations IS NULL OR jsonb_typeof(p_reservations) <> 'array' THEN
    RAISE EXCEPTION 'create_lesson_reservations_v1: p_reservations must be a JSONB array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'equipment_id') IS NULL THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: item missing equipment_id (%)', v_item;
    END IF;
    IF COALESCE((v_item->>'quantity')::INTEGER, 1) <= 0 THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: item quantity must be > 0';
    END IF;
  END LOOP;

  FOR v_reservation IN SELECT * FROM jsonb_array_elements(p_reservations) LOOP
    v_borrow_date := NULLIF(v_reservation->>'borrow_date','')::DATE;
    v_return_date := NULLIF(v_reservation->>'return_date','')::DATE;
    IF v_borrow_date IS NULL OR v_return_date IS NULL THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: every session needs borrow_date and return_date (got %)', v_reservation;
    END IF;
    IF v_return_date < v_borrow_date THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: return_date (%) before borrow_date (%) on session %',
                      v_return_date, v_borrow_date, v_reservation;
    END IF;
  END LOOP;

  WITH del AS (
    DELETE FROM public.reservations_new
     WHERE lesson_kit_id = p_kit_id
     RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_deleted_count FROM del;

  IF jsonb_array_length(p_reservations) = 0 THEN
    IF v_deleted_count > 0 THEN
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
          updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
      'inserted', 0,
      'deleted',  v_deleted_count,
      'ids',      to_jsonb(ARRAY[]::TEXT[])
    );
  END IF;

  FOR v_equipment_id IN
    SELECT DISTINCT (it->>'equipment_id')::TEXT
    FROM jsonb_array_elements(p_items) AS it
  LOOP
    SELECT name INTO v_equipment_name
      FROM public.equipment WHERE id = v_equipment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_lesson_reservations_v1: equipment % not found', v_equipment_id;
    END IF;
    v_equipment_ids := array_append(v_equipment_ids, v_equipment_id);
  END LOOP;

  v_session_index := 0;
  FOR v_reservation IN SELECT * FROM jsonb_array_elements(p_reservations) LOOP
    v_session_index := v_session_index + 1;
    v_borrow_date   := (v_reservation->>'borrow_date')::DATE;
    v_return_date   := (v_reservation->>'return_date')::DATE;
    v_borrow_time   := COALESCE(NULLIF(v_reservation->>'borrow_time','')::TIME, '00:00'::TIME);
    v_return_time   := COALESCE(NULLIF(v_reservation->>'return_time','')::TIME, '23:59'::TIME);
    v_new_start     := (v_borrow_date + v_borrow_time) AT TIME ZONE 'Asia/Jerusalem';
    v_new_end       := (v_return_date + v_return_time) AT TIME ZONE 'Asia/Jerusalem';
    v_session_label := COALESCE(v_reservation->>'id',
                                'session #' || v_session_index::TEXT);

    FOR v_equipment_id, v_quantity IN
      SELECT
        (it->>'equipment_id')::TEXT                             AS equipment_id,
        SUM(COALESCE((it->>'quantity')::INTEGER, 1))::INTEGER   AS total_qty
      FROM jsonb_array_elements(p_items) AS it
      GROUP BY (it->>'equipment_id')::TEXT
    LOOP
      SELECT COUNT(*) INTO v_healthy_count
        FROM public.equipment_units
        WHERE equipment_id = v_equipment_id
          AND status = 'תקין';

      SELECT COALESCE(SUM(ri.quantity), 0) INTO v_reserved_count
        FROM public.reservation_items ri
        JOIN public.reservations_new r ON r.id = ri.reservation_id
        WHERE ri.equipment_id = v_equipment_id
          AND r.status IN ('ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה')
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
        SELECT name INTO v_equipment_name
          FROM public.equipment WHERE id = v_equipment_id;
        RAISE EXCEPTION 'create_lesson_reservations_v1: not enough units for "%" (id=%) on % (%) — requested %, available % (healthy=%, reserved=%)',
                        v_equipment_name, v_equipment_id, v_borrow_date, v_session_label,
                        v_quantity, v_available, v_healthy_count, v_reserved_count;
      END IF;
    END LOOP;

    v_reservation_id := COALESCE(
      NULLIF(v_reservation->>'id',''),
      p_kit_id || '_s' || (v_session_index - 1)::TEXT
    );

    INSERT INTO public.reservations_new (
      id, email, phone, student_name, course, status, loan_type, project_name,
      borrow_date, borrow_time, return_date, return_time,
      created_at, submitted_at,
      sound_day_loan, sound_night_loan,
      crew_sound_name, crew_sound_phone,
      crew_photographer_name, crew_photographer_phone,
      studio_booking_id, lesson_id, booking_kind, lesson_auto, lesson_kit_id,
      lecturer_notes
    ) VALUES (
      v_reservation_id,
      v_reservation->>'email', v_reservation->>'phone', v_reservation->>'student_name',
      v_reservation->>'course',
      COALESCE(v_reservation->>'status','מאושר'),
      COALESCE(v_reservation->>'loan_type','שיעור'),
      v_reservation->>'project_name',
      v_borrow_date, v_reservation->>'borrow_time',
      v_return_date, v_reservation->>'return_time',
      COALESCE(NULLIF(v_reservation->>'created_at','')::TIMESTAMPTZ, NOW()),
      NULLIF(v_reservation->>'submitted_at','')::TIMESTAMPTZ,
      COALESCE((v_reservation->>'sound_day_loan')::BOOLEAN, FALSE),
      COALESCE((v_reservation->>'sound_night_loan')::BOOLEAN, FALSE),
      v_reservation->>'crew_sound_name', v_reservation->>'crew_sound_phone',
      v_reservation->>'crew_photographer_name', v_reservation->>'crew_photographer_phone',
      NULLIF(v_reservation->>'studio_booking_id','')::TEXT,
      NULLIF(v_reservation->>'lesson_id','')::TEXT,
      COALESCE(v_reservation->>'booking_kind','lesson'),
      COALESCE((v_reservation->>'lesson_auto')::BOOLEAN, TRUE),
      p_kit_id,
      NULLIF(v_reservation->>'lecturer_notes','')
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

    v_inserted_count := v_inserted_count + 1;
    v_inserted_ids   := array_append(v_inserted_ids, v_reservation_id);
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

  RETURN jsonb_build_object(
    'inserted', v_inserted_count,
    'deleted',  v_deleted_count,
    'ids',      to_jsonb(v_inserted_ids)
  );
END;
$function$;
