-- RPC: staff_review_reservation_update_v1 — a warehouse staff member reviews
-- the ONE pending update on an approved reservation: approves items in full,
-- approves reduced quantities, or rejects items / the whole update. The
-- decision is applied ATOMICALLY, with a fresh peak-concurrent availability
-- check under equipment row locks — the stock may have moved between the
-- student's submission and this review.
--
-- The update is ADD / INCREASE only (a "replace" concept was designed and
-- removed before launch — swapping is remove + add).
--
-- p_decisions: jsonb array — one entry per reservation_pending_items row of
-- this update, ALL rows must be decided (no silent defaults):
--   {"pending_item_id":12, "decision":"approve"}                        -- full qty
--   {"pending_item_id":12, "decision":"approve", "approved_quantity":1} -- reduced
--   {"pending_item_id":13, "decision":"reject"}
--
-- OUTCOMES (returned as `outcome` + written to review_status):
--   'approved'          — every item approved at full quantity.
--   'partial'           — something approved, something rejected/reduced.
--   'rejected'          — nothing approved.
--   'cancelled_started' — the loan started (or was returned / went overdue)
--                         while the update waited. NOTHING is applied; the
--                         update is closed as 'cancelled', every pending row
--                         flips to 'rejected', and the badge clears. The
--                         approved gear is untouched. (Spec: once the gear is
--                         out, pending items must never slip in.)
--
-- AVAILABILITY: all-or-nothing. If ANY approved item does not fit
-- healthy − peak(other blocking loans), the whole call raises
-- 'update_overbook — "<item>"' and applies nothing. The staff member sees
-- which item failed, removes/reduces it, and retries — no silent partial
-- approval. The peak CTE is copied verbatim from update_reservation_status_v1
-- 20260701120100 (MAX(c), '[)' ranges, blocking set, r.id <> self).
--
-- Existing RPCs (create_reservation_v2 / update_reservation_status_v1 /
-- student_modify_reservation_item_v1) are NOT touched by this feature.

CREATE OR REPLACE FUNCTION public.staff_review_reservation_update_v1(
  p_update_id     bigint,
  p_actor_id      uuid,
  p_actor_name    text,
  p_decisions     jsonb,
  p_staff_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation_id TEXT;
  v_review_status  TEXT;
  v_status         TEXT;
  v_loan_type      TEXT;
  v_borrow_date    DATE;
  v_borrow_time    TEXT;
  v_return_date    DATE;
  v_return_time    TEXT;
  v_is_external    BOOLEAN;
  v_new_start      TIMESTAMPTZ;
  v_new_end        TIMESTAMPTZ;
  v_pi             RECORD;
  v_dec            JSONB;
  v_decision       TEXT;
  v_appr_qty       INTEGER;
  v_eq_id          TEXT;
  v_eq_name        TEXT;
  v_ext_restricted BOOLEAN;
  v_ext_hold       INTEGER;
  v_healthy        INTEGER;
  v_reserved       INTEGER;
  v_final_qty      INTEGER;
  v_affected       TEXT[] := ARRAY[]::TEXT[];
  v_any_approved   BOOLEAN := FALSE;
  v_any_reduced    BOOLEAN := FALSE;
  v_any_rejected   BOOLEAN := FALSE;
  v_outcome        TEXT;
  v_private_qty    INTEGER;
  v_approved_list  JSONB := '[]'::JSONB;
  v_rejected_list  JSONB := '[]'::JSONB;
BEGIN
  IF p_update_id IS NULL THEN
    RAISE EXCEPTION 'staff_review_reservation_update_v1: p_update_id is required';
  END IF;
  IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
    RAISE EXCEPTION 'staff_review_reservation_update_v1: invalid_decisions — p_decisions must be an array';
  END IF;

  -- ── load + lock the ledger row, then the reservation ─────────────────────
  SELECT reservation_id, review_status
    INTO v_reservation_id, v_review_status
    FROM public.reservation_item_updates
   WHERE id = p_update_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_review_reservation_update_v1: update % not found', p_update_id;
  END IF;
  IF v_review_status <> 'pending' THEN
    RAISE EXCEPTION 'staff_review_reservation_update_v1: not_pending — update % was already reviewed (%)', p_update_id, v_review_status;
  END IF;

  SELECT status, loan_type, borrow_date, borrow_time, return_date, return_time
    INTO v_status, v_loan_type, v_borrow_date, v_borrow_time, v_return_date, v_return_time
    FROM public.reservations_new
   WHERE id = v_reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_review_reservation_update_v1: reservation % not found', v_reservation_id;
  END IF;

  -- ── the loan started / left מאושר while the update waited → safe close ───
  IF v_status <> 'מאושר' OR (
       v_borrow_date IS NOT NULL AND
       (v_borrow_date + COALESCE(NULLIF(v_borrow_time,'')::TIME, '00:00'::TIME))
         AT TIME ZONE 'Asia/Jerusalem' <= NOW()
     ) THEN
    UPDATE public.reservation_pending_items
       SET review_state = 'rejected'
     WHERE update_id = p_update_id AND review_state = 'pending';

    UPDATE public.reservation_item_updates
       SET review_status        = 'cancelled',
           reviewed_at          = NOW(),
           reviewed_by_staff_id = p_actor_id,
           reviewed_by_name     = p_actor_name,
           staff_message        = COALESCE(NULLIF(p_staff_message, ''), 'ההשאלה כבר יצאה לדרך — העדכון נסגר אוטומטית ולא הוחל.')
     WHERE id = p_update_id;

    UPDATE public.reservations_new
       SET pending_update_id = NULL, updated_at = NOW()
     WHERE id = v_reservation_id AND pending_update_id = p_update_id;

    INSERT INTO public.activity_logs (user_name, action, entity, entity_id, details)
    VALUES (COALESCE(p_actor_name, 'staff'), 'staff_cancel_update_started', 'reservation', v_reservation_id,
            jsonb_build_object('update_id', p_update_id, 'reservation_status', v_status));

    RETURN jsonb_build_object('ok', TRUE, 'outcome', 'cancelled_started', 'update_id', p_update_id);
  END IF;

  v_is_external := v_loan_type IN ('פרטית', 'הפקה');
  v_new_start := (v_borrow_date + COALESCE(NULLIF(v_borrow_time,'')::TIME, '00:00'::TIME)) AT TIME ZONE 'Asia/Jerusalem';
  v_new_end   := (v_return_date + COALESCE(NULLIF(v_return_time,'')::TIME, '23:59'::TIME)) AT TIME ZONE 'Asia/Jerusalem';

  -- ── walk every pending item; each must carry an explicit decision ────────
  FOR v_pi IN
    SELECT * FROM public.reservation_pending_items
     WHERE update_id = p_update_id AND review_state = 'pending'
     ORDER BY id
  LOOP
    SELECT d INTO v_dec
      FROM jsonb_array_elements(p_decisions) d
     WHERE (d->>'pending_item_id')::BIGINT = v_pi.id
     LIMIT 1;

    IF v_dec IS NULL THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: missing_decision — pending item % has no decision', v_pi.id;
    END IF;

    v_decision := v_dec->>'decision';
    IF v_decision NOT IN ('approve', 'reject') THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: invalid_decisions — unknown decision % for item %', v_decision, v_pi.id;
    END IF;

    IF v_decision = 'reject' THEN
      v_any_rejected := TRUE;
      UPDATE public.reservation_pending_items
         SET review_state = 'rejected'
       WHERE id = v_pi.id;
      v_rejected_list := v_rejected_list || jsonb_build_object(
        'name', v_pi.name, 'action', v_pi.action,
        'requested', v_pi.quantity, 'approved', 0);
      CONTINUE;
    END IF;

    -- approve (possibly reduced)
    v_appr_qty := COALESCE((v_dec->>'approved_quantity')::INTEGER, v_pi.quantity);
    IF v_appr_qty < 1 OR v_appr_qty > v_pi.quantity THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: invalid_decisions — approved_quantity % out of range for item %', v_appr_qty, v_pi.id;
    END IF;
    IF v_appr_qty < v_pi.quantity THEN
      v_any_reduced := TRUE;
    END IF;
    v_any_approved := TRUE;

    v_eq_id := v_pi.equipment_id;
    IF v_eq_id IS NULL THEN
      -- equipment deleted since submission → cannot approve
      RAISE EXCEPTION 'staff_review_reservation_update_v1: equipment for pending item % no longer exists', v_pi.id;
    END IF;

    -- lock the equipment row → serialize against concurrent approvers
    SELECT name, COALESCE(external_loan_restricted, FALSE), COALESCE(external_loan_hold_count, 0)
      INTO v_eq_name, v_ext_restricted, v_ext_hold
      FROM public.equipment WHERE id = v_eq_id FOR UPDATE;

    -- external-loan restriction may have been set since submission
    IF v_is_external AND v_ext_restricted THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: external_restricted — "%" (id=%) is blocked from external loans', v_eq_name, v_eq_id;
    END IF;

    SELECT COUNT(*) INTO v_healthy
      FROM public.equipment_units
     WHERE equipment_id = v_eq_id AND status = 'תקין';

    -- FINAL quantity of this equipment on the reservation after the whole
    -- update is applied: current rows + this approved quantity. Self is
    -- excluded from blk below, so the final figure competes only with OTHER
    -- blocking loans.
    SELECT COALESCE(SUM(ri.quantity), 0) INTO v_final_qty
      FROM public.reservation_items ri
     WHERE ri.reservation_id = v_reservation_id
       AND ri.equipment_id = v_eq_id;
    v_final_qty := v_final_qty + v_appr_qty;

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
          AND r.id <> v_reservation_id
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

    -- external hold-count keeps N units on campus (create_reservation_v2 parity)
    IF v_is_external THEN
      v_healthy := GREATEST(0, v_healthy - v_ext_hold);
    END IF;

    IF (v_healthy - v_reserved) < v_final_qty THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: update_overbook — not enough units for "%" (id=%) — requested %, available %',
                      v_eq_name, v_eq_id, v_appr_qty, GREATEST(0, v_healthy - v_reserved - (v_final_qty - v_appr_qty));
    END IF;

    -- ── apply this approved item ────────────────────────────────────────────
    IF v_pi.action = 'add' OR
       (v_pi.action = 'increase' AND NOT EXISTS (
          SELECT 1 FROM public.reservation_items WHERE id = v_pi.target_item_id)) THEN
      -- add — or an increase whose target row the student removed in the
      -- meantime (removal is always allowed): honor the intent, merge/insert.
      UPDATE public.reservation_items
         SET quantity = quantity + v_appr_qty
       WHERE reservation_id = v_reservation_id AND equipment_id = v_eq_id;
      IF NOT FOUND THEN
        INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
        VALUES (v_reservation_id, v_eq_id, COALESCE(v_pi.name, v_eq_name), v_appr_qty);
      END IF;

    ELSIF v_pi.action = 'increase' THEN
      UPDATE public.reservation_items
         SET quantity = quantity + v_appr_qty
       WHERE id = v_pi.target_item_id AND reservation_id = v_reservation_id;
    END IF;

    v_affected := array_append(v_affected, v_eq_id);

    UPDATE public.reservation_pending_items
       SET review_state = 'approved', approved_quantity = v_appr_qty
     WHERE id = v_pi.id;

    v_approved_list := v_approved_list || jsonb_build_object(
      'name', v_pi.name, 'action', v_pi.action,
      'requested', v_pi.quantity, 'approved', v_appr_qty);
  END LOOP;

  -- ── private-loan 4-item cap on the FINAL list (post-apply) ───────────────
  IF v_loan_type = 'פרטית' THEN
    SELECT COALESCE(SUM(ri.quantity), 0) INTO v_private_qty
      FROM public.reservation_items ri
      JOIN public.equipment e ON e.id = ri.equipment_id
     WHERE ri.reservation_id = v_reservation_id
       AND NOT COALESCE(e.private_loan_unlimited, FALSE);
    IF v_private_qty > 4 THEN
      RAISE EXCEPTION 'staff_review_reservation_update_v1: private_limit — private loans are capped at 4 items (would be %)', v_private_qty;
    END IF;
  END IF;

  -- ── close the ledger ─────────────────────────────────────────────────────
  v_outcome := CASE
    WHEN NOT v_any_approved THEN 'rejected'
    WHEN v_any_rejected OR v_any_reduced THEN 'partial'
    ELSE 'approved'
  END;

  UPDATE public.reservation_item_updates
     SET review_status        = v_outcome,
         reviewed_at          = NOW(),
         reviewed_by_staff_id = p_actor_id,
         reviewed_by_name     = p_actor_name,
         staff_message        = NULLIF(p_staff_message, '')
   WHERE id = p_update_id;

  UPDATE public.reservations_new
     SET pending_update_id = NULL, updated_at = NOW()
   WHERE id = v_reservation_id AND pending_update_id = p_update_id;

  -- available_units cache recompute (same formula as the sibling RPCs)
  IF array_length(v_affected, 1) > 0 THEN
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
     WHERE eq.id = ANY(v_affected);
  END IF;

  INSERT INTO public.activity_logs (user_name, action, entity, entity_id, details)
  VALUES (
    COALESCE(p_actor_name, 'staff'),
    'staff_review_update',
    'reservation',
    v_reservation_id,
    jsonb_build_object(
      'update_id', p_update_id,
      'outcome',   v_outcome,
      'approved',  v_approved_list,
      'rejected',  v_rejected_list,
      'staff_id',  p_actor_id
    )
  );

  RETURN jsonb_build_object(
    'ok',             TRUE,
    'outcome',        v_outcome,
    'update_id',      p_update_id,
    'reservation_id', v_reservation_id,
    'approved_items', v_approved_list,
    'rejected_items', v_rejected_list
  );
END;
$function$;

-- Server-side only: called by api/staff-review-reservation-update.js with the
-- service-role key after requireStaff. No direct client execution.
REVOKE ALL ON FUNCTION public.staff_review_reservation_update_v1(bigint, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_review_reservation_update_v1(bigint, uuid, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_review_reservation_update_v1(bigint, uuid, text, jsonb, text) TO service_role;
