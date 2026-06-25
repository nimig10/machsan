-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic availability guard at APPROVAL time (update_reservation_status_v1).
--
-- THE GAP THIS CLOSES:
--   create_reservation_v2 is the ONLY place that checks equipment availability,
--   and it only runs at submission. Pending ('ממתין') requests do NOT block each
--   other, so two students can both submit for the same item and both pass the
--   create-time check. The warehouse can then approve BOTH — and approval had
--   NO server-side availability check at all (the only guard was client-side,
--   computed against possibly-stale in-memory state). Under a race / stale
--   snapshot (common on mobile, multiple sessions) two approvals slip through
--   and the same units are double-booked across overlapping windows.
--
-- THE FIX (mirrors PR #48's studio EXCLUDE-constraint philosophy: enforce in the
-- DB, race-proof):
--   When a reservation transitions INTO 'מאושר' from a non-blocking status, take
--   FOR UPDATE locks on every equipment row it touches (serializing concurrent
--   approvers), and verify per item that
--       healthy_units - overlapping_blocking_demand(excluding THIS reservation)
--   still covers the requested quantity. If not, RAISE with the stable token
--   'approve_overbook'. The lock + recompute happen in the same transaction as
--   the status flip, so two approvers competing for the last unit cannot both win.
--
-- ⚠️ ANTI-REGRESSION: this is the current definition of update_reservation_status_v1
-- byte-for-byte, with ONLY the guard block + its DECLARE vars added between the
-- equipment-id collection and the status UPDATE. The existing available_units
-- recompute is unchanged.
--   * The overlap window + blocking-status set ('מאושר','באיחור','פעילה') mirror
--     create_reservation_v2 exactly — keep them in sync.
--   * The guard runs ONLY for the מאושר transition from a non-blocking old status,
--     so idempotent re-approvals and return/overdue transitions are untouched.
--   * THIS reservation is excluded from the demand count (r.id <> p_reservation_id)
--     so it never blocks itself.
-- ─────────────────────────────────────────────────────────────────────────────

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

        -- Overlapping demand from OTHER already-blocking reservations.
        SELECT COALESCE(SUM(ri.quantity), 0) INTO v_reserved
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
                ) && tstzrange(v_new_start, v_new_end, '[)');

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
