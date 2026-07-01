-- Approval-time availability guard = PEAK-CONCURRENT demand, not a naive SUM.
--
-- Mirror of 20260701120000 (create_reservation_v2) for the approve transition.
-- The guard computed reserved demand as SUM(ri.quantity) over every OTHER
-- blocking reservation overlapping the window; when the approved reservation's
-- window spans several blocking loans that don't overlap EACH OTHER, the sum
-- over-counts and a genuinely-available approval is rejected with
-- 'approve_overbook'. Units are fungible → reserved demand is the MAXIMUM
-- simultaneous quantity in use within [v_new_start, v_new_end), evaluated at each
-- blocker's start (clamped to the window start).
--
-- ⚠️ ANTI-REGRESSION: this re-declares update_reservation_status_v1 BYTE-FOR-BYTE
-- on 20260625120000. The ONLY change is the v_reserved computation: SUM →
-- peak-concurrent. Everything else is preserved:
--   * The FOR UPDATE row locks (serialize concurrent approvers) stay in place.
--   * The guard still runs ONLY for the מאושר transition from a non-blocking old
--     status (idempotent re-approve and באיחור/פעילה → מאושר untouched).
--   * THIS reservation is still excluded (r.id <> p_reservation_id).
--   * The blocking-status set, overlap window and '[)' semantics are IDENTICAL to
--     create_reservation_v2 — keep them in sync.
--   * The available_units recompute (cache column) is unchanged.

CREATE OR REPLACE FUNCTION public.update_reservation_status_v1(p_reservation_id text, p_new_status text, p_returned_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status     TEXT;
  v_equipment_ids  TEXT[];
  v_allowed        TEXT[] := ARRAY[
    'ממתין',
    'אישור ראש מחלקה',
    'מאושר',
    'נדחה',
    'בוטל',
    'מבוטל',
    'הוחזר',
    'באיחור',
    'פעילה'
  ];
  -- Approval availability guard (added 2026-06-25).
  v_new_start      TIMESTAMPTZ;
  v_new_end        TIMESTAMPTZ;
  v_eq_id          TEXT;
  v_qty            INTEGER;
  v_healthy        INTEGER;
  v_reserved       INTEGER;
  v_eq_name        TEXT;
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RAISE EXCEPTION 'update_reservation_status_v1: p_reservation_id is required';
  END IF;
  IF p_new_status IS NULL OR NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'update_reservation_status_v1: invalid status "%"', p_new_status;
  END IF;

  SELECT status INTO v_old_status
    FROM public.reservations_new
    WHERE id = p_reservation_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_reservation_status_v1: reservation % not found', p_reservation_id;
  END IF;

  SELECT array_agg(DISTINCT equipment_id) INTO v_equipment_ids
    FROM public.reservation_items
    WHERE reservation_id = p_reservation_id;

  -- ── Atomic over-booking guard for the approve transition ──────────────────
  -- Only when entering 'מאושר' from a status that did NOT already hold stock.
  -- Idempotent re-approve (already מאושר) and באיחור/פעילה → מאושר are skipped,
  -- since those already count against availability.
  IF p_new_status = 'מאושר' AND v_old_status IS DISTINCT FROM 'מאושר'
     AND v_old_status <> 'באיחור' AND v_old_status <> 'פעילה' THEN
    SELECT (borrow_date + COALESCE(NULLIF(borrow_time,'')::TIME, '00:00'::TIME)) AT TIME ZONE 'Asia/Jerusalem',
           (return_date + COALESCE(NULLIF(return_time,'')::TIME, '23:59'::TIME)) AT TIME ZONE 'Asia/Jerusalem'
      INTO v_new_start, v_new_end
      FROM public.reservations_new
      WHERE id = p_reservation_id;

    IF v_new_start IS NOT NULL AND v_new_end IS NOT NULL THEN
      FOR v_eq_id, v_qty IN
        SELECT equipment_id, SUM(COALESCE(quantity,1))::INTEGER
          FROM public.reservation_items
          WHERE reservation_id = p_reservation_id
            AND equipment_id IS NOT NULL
          GROUP BY equipment_id
      LOOP
        -- Lock the equipment row → serialize concurrent approvers for this item.
        SELECT name INTO v_eq_name FROM public.equipment WHERE id = v_eq_id FOR UPDATE;

        SELECT COUNT(*) INTO v_healthy
          FROM public.equipment_units
          WHERE equipment_id = v_eq_id
            AND status = 'תקין';

        -- Overlapping demand from OTHER already-blocking reservations —
        -- PEAK-CONCURRENT (max simultaneous), not SUM. Blocking loans in disjoint
        -- windows do not add up: one physical unit serves consecutive
        -- non-overlapping loans. Peak is reached at some blocker's start (clamped
        -- to v_new_start), so we evaluate the running demand at those points only.
        WITH blk AS (
          SELECT ri.quantity AS qty,
                 GREATEST(
                   (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                     AT TIME ZONE 'Asia/Jerusalem',
                   v_new_start
                 ) AS s,
                 (r.return_date + COALESCE(NULLIF(r.return_time,'')::TIME, '23:59'::TIME))
                   AT TIME ZONE 'Asia/Jerusalem' AS e
            FROM public.reservation_items ri
            JOIN public.reservations_new r ON r.id = ri.reservation_id
            WHERE ri.equipment_id = v_eq_id
              AND r.id <> p_reservation_id
              AND r.status IN ('מאושר','באיחור','פעילה')
              AND r.borrow_date IS NOT NULL
              AND r.return_date IS NOT NULL
              AND tstzrange(
                    (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME))
                      AT TIME ZONE 'Asia/Jerusalem',
                    (r.return_date + COALESCE(NULLIF(r.return_time,'')::TIME, '23:59'::TIME))
                      AT TIME ZONE 'Asia/Jerusalem',
                    '[)'
                  ) && tstzrange(v_new_start, v_new_end, '[)')
        )
        SELECT COALESCE(MAX(c), 0) INTO v_reserved
          FROM (
            SELECT (SELECT COALESCE(SUM(b2.qty), 0)
                      FROM blk b2
                      WHERE b2.s <= p.t AND p.t < b2.e) AS c
              FROM (SELECT s AS t FROM blk UNION SELECT v_new_start) p
              WHERE p.t < v_new_end
          ) x;

        IF (v_healthy - v_reserved) < v_qty THEN
          RAISE EXCEPTION 'update_reservation_status_v1: approve_overbook — not enough units for "%" (id=%) — requested %, available % (healthy=%, reserved=%)',
                          v_eq_name, v_eq_id, v_qty, (v_healthy - v_reserved), v_healthy, v_reserved;
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.reservations_new
    SET status      = p_new_status,
        returned_at = CASE
                        WHEN p_new_status = 'הוחזר' THEN COALESCE(p_returned_at, NOW())
                        ELSE COALESCE(p_returned_at, returned_at)
                      END,
        updated_at  = NOW()
    WHERE id = p_reservation_id;

  IF v_equipment_ids IS NOT NULL AND array_length(v_equipment_ids, 1) > 0 THEN
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

  RETURN jsonb_build_object(
    'id',         p_reservation_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'changed',    (v_old_status IS DISTINCT FROM p_new_status)
  );
END;
$function$;
