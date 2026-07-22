-- RPC: student_submit_reservation_update_v1 — a student submits ONE update
-- (a batch of add / increase ops staged in the client draft) for an existing
-- loan reservation. Sibling of student_modify_reservation_item_v1 (which
-- stays untouched and keeps handling decrement/remove/cancel — removal is NOT
-- an update and does not touch the counter).
--
-- The feature is deliberately just ADD and INCREASE. A "replace" op was
-- designed and removed before launch (product decision, 2026-07-22): swapping
-- is expressed as remove + add, which everyone already understands.
--
-- p_ops: jsonb array. Every op has "action"; fields per action:
--   {"action":"add",      "equipment_id":"…", "quantity":N}
--   {"action":"increase", "item_id":123,      "quantity":N}   -- N = the DELTA
--
-- GUARDS (all inside one transaction, serialized by FOR UPDATE on the
-- reservation row — two concurrent submits on the same reservation cannot
-- both pass the counter check):
--   1. ownership        — reservations_new.email must equal p_actor_email.
--   2. status whitelist — ממתין / אישור ראש מחלקה / מאושר only; lessons
--                         (loan_type='שיעור' / booking_kind='lesson' /
--                         lesson_auto) excluded entirely.
--   3. not started      — borrow moment (Asia/Jerusalem) must still be in the
--                         future: a raw-מאושר row whose pickup time arrived is
--                         effectively פעילה and is NOT editable. Applied to
--                         every status (a stale ממתין past its pickup is just
--                         as uneditable).
--   4. counter          — at most 2 updates per reservation, and no second
--                         submit while one is pending review.
--   5. external-loan    — for פרטית/הפקה: equipment flagged
--                         external_loan_restricted cannot be added / increased
--                         (mirror of create_reservation_v2's guard).
--   6. private-4 limit  — for פרטית: the hypothetical POST-change list must
--                         keep getPrivateLoanLimitedQty ≤ 4 (sum of quantities
--                         skipping private_loan_unlimited equipment — the
--                         exact creation-form semantics, not a row count).
--   7. availability     — IMMEDIATE PATH ONLY (see below): the final quantity
--                         per affected equipment must fit healthy − peak-
--                         concurrent demand of blocking reservations. Copied
--                         from create_reservation_v2 20260701120000 (MAX(c),
--                         '[)' ranges, blocking set 'מאושר','באיחור','פעילה').
--
-- NOTE: the per-loan-type LEAD-TIME gate is deliberately NOT here. It lives in
-- src/utils/loanPolicy.js and is enforced by api/student-submit-reservation-
-- update.js before calling this RPC — one shared rule source for client and
-- server. The check is monotonic in time, so doing it pre-RPC is race-free.
--
-- TWO PATHS by the reservation's current status:
--   * ממתין / אישור ראש מחלקה (non-blocking) — ops are applied DIRECTLY to
--     reservation_items (the reservation hasn't been approved yet; the full
--     updated list will be vetted by the normal warehouse approval, which has
--     its own atomic guard). Ledger row is written as 'auto_applied'.
--   * מאושר (blocking) — nothing touches reservation_items. Ops are parked in
--     reservation_pending_items, the ledger row is 'pending', and
--     reservations_new.pending_update_id is set (the "בדיקת עדכון" badge).
--     The approved gear keeps holding stock; the pending gear holds NOTHING
--     until staff_review_reservation_update_v1 approves it.

CREATE OR REPLACE FUNCTION public.student_submit_reservation_update_v1(
  p_reservation_id text,
  p_actor_email    text,
  p_ops            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email          TEXT;
  v_status         TEXT;
  v_loan_type      TEXT;
  v_booking_kind   TEXT;
  v_lesson_auto    BOOLEAN;
  v_borrow_date    DATE;
  v_borrow_time    TEXT;
  v_return_date    DATE;
  v_return_time    TEXT;
  v_is_external    BOOLEAN;
  v_updates_used   INTEGER;
  v_pending_cnt    INTEGER;
  v_update_id      BIGINT;
  v_mode           TEXT;
  v_op             JSONB;
  v_action         TEXT;
  v_eq_id          TEXT;
  v_qty            INTEGER;
  v_target_id      BIGINT;
  v_t_eq_id        TEXT;
  v_eq_name        TEXT;
  v_eq_exists      BOOLEAN;
  v_ext_restricted BOOLEAN;
  v_ext_hold       INTEGER;
  v_private_qty    INTEGER;
  v_new_start      TIMESTAMPTZ;
  v_new_end        TIMESTAMPTZ;
  v_healthy        INTEGER;
  v_reserved       INTEGER;
  v_final_qty      INTEGER;
  v_affected       TEXT[] := ARRAY[]::TEXT[];
  v_ops_count      INTEGER;
BEGIN
  -- ── input validation ─────────────────────────────────────────────────────
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: p_reservation_id is required';
  END IF;
  IF p_actor_email IS NULL OR p_actor_email = '' THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: p_actor_email is required';
  END IF;
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — p_ops must be a non-empty array';
  END IF;
  SELECT jsonb_array_length(p_ops) INTO v_ops_count;
  IF v_ops_count > 30 THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — too many operations';
  END IF;

  -- ── load + lock the reservation (THE serialization point) ────────────────
  SELECT email, status, loan_type, booking_kind, lesson_auto,
         borrow_date, borrow_time, return_date, return_time
    INTO v_email, v_status, v_loan_type, v_booking_kind, v_lesson_auto,
         v_borrow_date, v_borrow_time, v_return_date, v_return_time
    FROM public.reservations_new
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: reservation % not found', p_reservation_id;
  END IF;

  -- 1. ownership
  IF LOWER(COALESCE(v_email, '')) <> LOWER(p_actor_email) THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: forbidden (not owner)';
  END IF;

  -- 2. status whitelist + lesson exclusion
  IF v_status NOT IN ('ממתין', 'אישור ראש מחלקה', 'מאושר') THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: status_not_editable — reservation status % is not editable', v_status;
  END IF;
  IF v_loan_type = 'שיעור' OR v_booking_kind = 'lesson' OR COALESCE(v_lesson_auto, FALSE) THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: lesson_not_editable — lesson reservations cannot be updated';
  END IF;

  -- 3. effective status: pickup moment must still be in the future
  IF v_borrow_date IS NOT NULL AND
     (v_borrow_date + COALESCE(NULLIF(v_borrow_time,'')::TIME, '00:00'::TIME))
       AT TIME ZONE 'Asia/Jerusalem' <= NOW() THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: already_started — pickup time has arrived';
  END IF;

  -- 4. counter: max 2 updates, no concurrent pending update
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE review_status = 'pending')
    INTO v_updates_used, v_pending_cnt
    FROM public.reservation_item_updates
   WHERE reservation_id = p_reservation_id;

  IF v_pending_cnt > 0 THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: update_pending — a previous update is still awaiting review';
  END IF;
  IF v_updates_used >= 2 THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: update_limit — both updates have been used';
  END IF;

  v_is_external := v_loan_type IN ('פרטית', 'הפקה');

  -- ── per-op validation (nothing written yet) ──────────────────────────────
  FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops)
  LOOP
    v_action := v_op->>'action';
    IF v_action IS NULL OR v_action NOT IN ('add', 'increase') THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — unknown action %', COALESCE(v_action, '(null)');
    END IF;

    v_qty := COALESCE((v_op->>'quantity')::INTEGER, 0);
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — quantity must be >= 1';
    END IF;

    IF v_action = 'add' THEN
      v_eq_id := v_op->>'equipment_id';
      IF v_eq_id IS NULL OR v_eq_id = '' THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — equipment_id is required for add';
      END IF;
      SELECT TRUE, name, COALESCE(external_loan_restricted, FALSE)
        INTO v_eq_exists, v_eq_name, v_ext_restricted
        FROM public.equipment WHERE id = v_eq_id;
      IF v_eq_exists IS NOT TRUE THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: equipment % not found', v_eq_id;
      END IF;
      -- 5. external-loan restriction (mirror of create_reservation_v2)
      IF v_is_external AND v_ext_restricted THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: external_restricted — "%" (id=%) is blocked from external loans', v_eq_name, v_eq_id;
      END IF;
      v_eq_exists := NULL;
    END IF;

    IF v_action = 'increase' THEN
      v_target_id := (v_op->>'item_id')::BIGINT;
      IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — item_id is required for increase';
      END IF;
      SELECT ri.equipment_id INTO v_t_eq_id
        FROM public.reservation_items ri
       WHERE ri.id = v_target_id AND ri.reservation_id = p_reservation_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: item % not found on reservation %', v_target_id, p_reservation_id;
      END IF;
      -- increasing a restricted item inside an external loan is also blocked
      IF v_is_external AND v_t_eq_id IS NOT NULL THEN
        SELECT COALESCE(external_loan_restricted, FALSE), name
          INTO v_ext_restricted, v_eq_name
          FROM public.equipment WHERE id = v_t_eq_id;
        IF v_ext_restricted THEN
          RAISE EXCEPTION 'student_submit_reservation_update_v1: external_restricted — "%" (id=%) is blocked from external loans', v_eq_name, v_t_eq_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- duplicate-target guards: two increases of the same item, or two adds of
  -- the same equipment, make the outcome order-dependent — reject the batch.
  IF (SELECT COUNT(*) FROM (
        SELECT op->>'item_id' AS t FROM jsonb_array_elements(p_ops) op
         WHERE op->>'action' = 'increase'
      ) d GROUP BY t HAVING COUNT(*) > 1 LIMIT 1) IS NOT NULL THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — duplicate item target';
  END IF;
  IF (SELECT COUNT(*) FROM (
        SELECT op->>'equipment_id' AS e FROM jsonb_array_elements(p_ops) op
         WHERE op->>'action' = 'add'
      ) d GROUP BY e HAVING COUNT(*) > 1 LIMIT 1) IS NOT NULL THEN
    RAISE EXCEPTION 'student_submit_reservation_update_v1: invalid_ops — duplicate add of the same equipment';
  END IF;

  -- 6. private-loan 4-item cap on the HYPOTHETICAL post-change list.
  -- Exact getPrivateLoanLimitedQty semantics: sum quantities, skipping
  -- equipment flagged private_loan_unlimited.
  IF v_loan_type = 'פרטית' THEN
    SELECT COALESCE(SUM(t.q), 0) INTO v_private_qty FROM (
      SELECT ri.quantity AS q, ri.equipment_id AS eq
        FROM public.reservation_items ri
       WHERE ri.reservation_id = p_reservation_id
      UNION ALL
      SELECT (op->>'quantity')::INTEGER, op->>'equipment_id'
        FROM jsonb_array_elements(p_ops) op
       WHERE op->>'action' = 'add'
      UNION ALL
      -- increase deltas land on the target item's equipment
      SELECT (op->>'quantity')::INTEGER, ri.equipment_id
        FROM jsonb_array_elements(p_ops) op
        JOIN public.reservation_items ri ON ri.id = (op->>'item_id')::BIGINT
       WHERE op->>'action' = 'increase'
    ) t
    JOIN public.equipment e ON e.id = t.eq
    WHERE NOT COALESCE(e.private_loan_unlimited, FALSE);

    IF v_private_qty > 4 THEN
      RAISE EXCEPTION 'student_submit_reservation_update_v1: private_limit — private loans are capped at 4 items (would be %)', v_private_qty;
    END IF;
  END IF;

  v_update_id := NULL;

  IF v_status IN ('ממתין', 'אישור ראש מחלקה') THEN
    -- ═══ IMMEDIATE PATH — apply straight onto reservation_items ═══════════
    v_mode := 'auto_applied';

    -- 7. availability for the DELTA, per affected equipment: final quantity
    -- on this reservation must fit healthy − peak(other blocking loans).
    -- Copied from create_reservation_v2 20260701120000; this reservation is
    -- non-blocking here, and r.id <> self keeps it excluded regardless.
    v_new_start := (v_borrow_date + COALESCE(NULLIF(v_borrow_time,'')::TIME, '00:00'::TIME)) AT TIME ZONE 'Asia/Jerusalem';
    v_new_end   := (v_return_date + COALESCE(NULLIF(v_return_time,'')::TIME, '23:59'::TIME)) AT TIME ZONE 'Asia/Jerusalem';

    FOR v_eq_id, v_final_qty IN
      SELECT t.eq, SUM(t.q)::INTEGER FROM (
        SELECT ri.equipment_id AS eq, ri.quantity AS q
          FROM public.reservation_items ri
         WHERE ri.reservation_id = p_reservation_id
        UNION ALL
        SELECT op->>'equipment_id', (op->>'quantity')::INTEGER
          FROM jsonb_array_elements(p_ops) op
         WHERE op->>'action' = 'add'
        UNION ALL
        SELECT ri.equipment_id, (op->>'quantity')::INTEGER
          FROM jsonb_array_elements(p_ops) op
          JOIN public.reservation_items ri ON ri.id = (op->>'item_id')::BIGINT
         WHERE op->>'action' = 'increase'
      ) t
      WHERE t.eq IS NOT NULL
        -- only equipment this batch touches — untouched items were already
        -- validated when they entered the reservation
        AND t.eq IN (
          SELECT op->>'equipment_id' FROM jsonb_array_elements(p_ops) op
           WHERE op->>'action' = 'add'
          UNION
          SELECT ri.equipment_id FROM jsonb_array_elements(p_ops) op
            JOIN public.reservation_items ri ON ri.id = (op->>'item_id')::BIGINT
           WHERE op->>'action' = 'increase'
        )
      GROUP BY t.eq
    LOOP
      -- lock the equipment row → serialize against concurrent approvers
      SELECT name, COALESCE(external_loan_hold_count, 0)
        INTO v_eq_name, v_ext_hold
        FROM public.equipment WHERE id = v_eq_id FOR UPDATE;

      SELECT COUNT(*) INTO v_healthy
        FROM public.equipment_units
       WHERE equipment_id = v_eq_id AND status = 'תקין';

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

      -- external hold-count keeps N units on campus (create_reservation_v2 parity)
      IF v_is_external THEN
        v_healthy := GREATEST(0, v_healthy - v_ext_hold);
      END IF;

      IF (v_healthy - v_reserved) < v_final_qty THEN
        RAISE EXCEPTION 'student_submit_reservation_update_v1: not_available — not enough units for "%" (id=%) — requested %, available %',
                        v_eq_name, v_eq_id, v_final_qty, GREATEST(0, v_healthy - v_reserved);
      END IF;
    END LOOP;

    -- ledger row (auto-applied, still consumes one of the 2 updates)
    INSERT INTO public.reservation_item_updates
      (reservation_id, update_number, base_status, review_status, student_email)
    VALUES
      (p_reservation_id, v_updates_used + 1, v_status, 'auto_applied', LOWER(p_actor_email))
    RETURNING id INTO v_update_id;

    -- per-op audit rows under the ledger (review_state mirrors the outcome)
    INSERT INTO public.reservation_pending_items
      (update_id, reservation_id, action, equipment_id, name, quantity,
       target_item_id, review_state, approved_quantity)
    SELECT v_update_id, p_reservation_id, op->>'action',
           COALESCE(op->>'equipment_id', ri.equipment_id),
           COALESCE(op->>'name', e.name),
           (op->>'quantity')::INTEGER,
           NULLIF(op->>'item_id','')::BIGINT,
           'approved',
           (op->>'quantity')::INTEGER
      FROM jsonb_array_elements(p_ops) op
      LEFT JOIN public.reservation_items ri ON ri.id = NULLIF(op->>'item_id','')::BIGINT
      LEFT JOIN public.equipment e ON e.id = COALESCE(op->>'equipment_id', ri.equipment_id);

    -- apply the ops
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops)
    LOOP
      v_action := v_op->>'action';
      v_qty := (v_op->>'quantity')::INTEGER;

      IF v_action = 'add' THEN
        v_eq_id := v_op->>'equipment_id';
        SELECT name INTO v_eq_name FROM public.equipment WHERE id = v_eq_id;
        -- merge into an existing row for the same equipment if there is one
        UPDATE public.reservation_items
           SET quantity = quantity + v_qty
         WHERE reservation_id = p_reservation_id AND equipment_id = v_eq_id;
        IF NOT FOUND THEN
          INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity)
          VALUES (p_reservation_id, v_eq_id, COALESCE(v_op->>'name', v_eq_name), v_qty);
        END IF;
        v_affected := array_append(v_affected, v_eq_id);

      ELSIF v_action = 'increase' THEN
        v_target_id := (v_op->>'item_id')::BIGINT;
        UPDATE public.reservation_items
           SET quantity = quantity + v_qty
         WHERE id = v_target_id AND reservation_id = p_reservation_id
         RETURNING equipment_id INTO v_t_eq_id;
        IF v_t_eq_id IS NOT NULL THEN
          v_affected := array_append(v_affected, v_t_eq_id);
        END IF;
      END IF;
    END LOOP;

  ELSE
    -- ═══ PENDING PATH (מאושר) — park everything for staff review ══════════
    v_mode := 'pending';

    INSERT INTO public.reservation_item_updates
      (reservation_id, update_number, base_status, review_status, student_email)
    VALUES
      (p_reservation_id, v_updates_used + 1, v_status, 'pending', LOWER(p_actor_email))
    RETURNING id INTO v_update_id;

    INSERT INTO public.reservation_pending_items
      (update_id, reservation_id, action, equipment_id, name, quantity, target_item_id)
    SELECT v_update_id, p_reservation_id, op->>'action',
           COALESCE(op->>'equipment_id', ri.equipment_id),
           COALESCE(op->>'name', e.name),
           (op->>'quantity')::INTEGER,
           NULLIF(op->>'item_id','')::BIGINT
      FROM jsonb_array_elements(p_ops) op
      LEFT JOIN public.reservation_items ri ON ri.id = NULLIF(op->>'item_id','')::BIGINT
      LEFT JOIN public.equipment e ON e.id = COALESCE(op->>'equipment_id', ri.equipment_id);

    -- the "בדיקת עדכון" badge — display-only column, see 20260722120200
    UPDATE public.reservations_new
       SET pending_update_id = v_update_id, updated_at = NOW()
     WHERE id = p_reservation_id;
  END IF;

  -- available_units cache recompute for touched equipment (immediate path
  -- only writes reservation_items; harmless no-op for non-blocking statuses,
  -- kept for parity with student_modify_reservation_item_v1)
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
    LOWER(p_actor_email),
    'student_submit_update',
    'reservation',
    p_reservation_id,
    jsonb_build_object(
      'update_id',     v_update_id,
      'update_number', v_updates_used + 1,
      'mode',          v_mode,
      'base_status',   v_status,
      'ops',           p_ops
    )
  );

  RETURN jsonb_build_object(
    'ok',            TRUE,
    'update_id',     v_update_id,
    'update_number', v_updates_used + 1,
    'mode',          v_mode,
    'updates_used',  v_updates_used + 1,
    'updates_left',  2 - (v_updates_used + 1)
  );
END;
$function$;

-- Server-side only: the API endpoint calls this with the service-role key
-- after deriving the actor email from the JWT. No direct client execution.
REVOKE ALL ON FUNCTION public.student_submit_reservation_update_v1(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_submit_reservation_update_v1(text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_reservation_update_v1(text, text, jsonb) TO service_role;
