-- CI test suite for the student equipment-update feature (reservation-updates).
-- Calls the REAL RPCs (student_submit_reservation_update_v1 /
-- staff_review_reservation_update_v1 / student_modify_reservation_item_v1 /
-- create_reservation_v2) against self-contained synthetic rows, then cleans
-- up. Wired into `npm run test:db` (scripts/run-db-smoke.mjs).
--
-- The feature is ADD + INCREASE only (a "replace" op was designed and removed
-- before launch — swapping is remove + add).
--
-- NOT covered here (by design): the lead-time gate (Node layer,
-- scripts/run-loan-policy-tests.mjs); emails; client UI; true cross-session
-- races (the FOR UPDATE row lock + uq_riu_one_pending_per_reservation are the
-- structural guards for those).

CREATE OR REPLACE FUNCTION public.run_reservation_update_tests()
RETURNS TABLE(scenario text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  eq1 TEXT := 'test-upd-eq-1';      -- 4 healthy units
  eq2 TEXT := 'test-upd-eq-2';      -- 3 healthy units
  eq3 TEXT := 'test-upd-eq-ext';    -- external_loan_restricted
  r_pend    TEXT := 'test-upd-res-pending';
  r_dept    TEXT := 'test-upd-res-dept';
  r_appr    TEXT := 'test-upd-res-approved';
  r_appr2   TEXT := 'test-upd-res-approved2';
  r_started TEXT := 'test-upd-res-started';
  r_other   TEXT := 'test-upd-res-other';
  s_email TEXT := 'upd-test@smoke.dev';
  v_res JSONB;
  v_cnt INT;
  v_qty INT;
  v_pu BIGINT;
  v_pi BIGINT;
  v_item_old BIGINT;
  v_err TEXT;
BEGIN
  DELETE FROM public.reservations_new WHERE id LIKE 'test-upd-res-%';
  DELETE FROM public.equipment WHERE id LIKE 'test-upd-eq-%';
  DELETE FROM public.activity_logs WHERE entity_id LIKE 'test-upd-res-%';

  INSERT INTO public.equipment (id, name, category, total_quantity) VALUES
    (eq1, 'טסט עדכון 1', 'טסט', 4),
    (eq2, 'טסט עדכון 2', 'טסט', 3),
    (eq3, 'טסט עדכון מוגבל', 'טסט', 2);
  UPDATE public.equipment SET external_loan_restricted = TRUE WHERE id = eq3;
  INSERT INTO public.equipment_units (id, equipment_id, status)
  SELECT eq1 || '_' || g, eq1, 'תקין' FROM generate_series(1,4) g;
  INSERT INTO public.equipment_units (id, equipment_id, status)
  SELECT eq2 || '_' || g, eq2, 'תקין' FROM generate_series(1,3) g;
  INSERT INTO public.equipment_units (id, equipment_id, status)
  SELECT eq3 || '_' || g, eq3, 'תקין' FROM generate_series(1,2) g;

  -- 1. add on ממתין applies immediately
  INSERT INTO public.reservations_new (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_pend, s_email, 'טסט', 'ממתין', 'פרטית', CURRENT_DATE + 5, '09:00', CURRENT_DATE + 6, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity) VALUES (r_pend, eq1, 'טסט עדכון 1', 1);
  v_res := public.student_submit_reservation_update_v1(r_pend, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',1)));
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_items WHERE reservation_id = r_pend;
  RETURN QUERY SELECT 'add on ממתין → applied immediately (2 items, mode=auto_applied)'::text,
    '2/auto_applied'::text, v_cnt || '/' || (v_res->>'mode'), (v_cnt = 2 AND v_res->>'mode' = 'auto_applied');

  -- 2. add on אישור ראש מחלקה applies immediately
  INSERT INTO public.reservations_new (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_dept, s_email, 'טסט', 'אישור ראש מחלקה', 'הפקה', CURRENT_DATE + 10, '09:00', CURRENT_DATE + 11, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity) VALUES (r_dept, eq1, 'טסט עדכון 1', 1);
  v_res := public.student_submit_reservation_update_v1(r_dept, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',1)));
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_items WHERE reservation_id = r_dept;
  RETURN QUERY SELECT 'add on אישור ראש מחלקה → applied immediately'::text,
    '2/auto_applied'::text, v_cnt || '/' || (v_res->>'mode'), (v_cnt = 2 AND v_res->>'mode' = 'auto_applied');

  -- 3. submit on מאושר → pending path, approved items untouched, badge set
  INSERT INTO public.reservations_new (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_appr, s_email, 'טסט', 'מאושר', 'פרטית', CURRENT_DATE + 5, '09:00', CURRENT_DATE + 6, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity) VALUES (r_appr, eq1, 'טסט עדכון 1', 1)
  RETURNING id INTO v_item_old;
  v_res := public.student_submit_reservation_update_v1(r_appr, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',2)));
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_items WHERE reservation_id = r_appr;
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr;
  RETURN QUERY SELECT 'submit on מאושר → pending; reservation_items untouched; badge set'::text,
    '1/pending/set'::text, v_cnt || '/' || (v_res->>'mode') || '/' || CASE WHEN v_pu IS NOT NULL THEN 'set' ELSE 'null' END,
    (v_cnt = 1 AND v_res->>'mode' = 'pending' AND v_pu IS NOT NULL);

  -- 4. pending items hold NO stock (competing booking of all units succeeds)
  BEGIN
    v_err := public.create_reservation_v2(
      jsonb_build_object('id', r_other, 'email', 'other-student@smoke.dev', 'student_name', 'אחר',
        'loan_type', 'פרטית', 'borrow_date', (CURRENT_DATE + 5)::text, 'borrow_time', '09:00',
        'return_date', (CURRENT_DATE + 6)::text, 'return_time', '17:00'),
      jsonb_build_array(jsonb_build_object('equipment_id', eq2, 'quantity', 3, 'name', 'טסט עדכון 2')));
    RETURN QUERY SELECT 'pending items hold no stock (competing booking of all units succeeds)'::text,
      'created'::text, 'created'::text, TRUE;
    DELETE FROM public.reservations_new WHERE id = v_err OR id = r_other;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'pending items hold no stock (competing booking of all units succeeds)'::text,
      'created'::text, SQLERRM::text, FALSE;
  END;

  -- 5. second submit while one is pending → update_pending
  BEGIN
    v_res := public.student_submit_reservation_update_v1(r_appr, s_email,
      jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq1,'quantity',1)));
    RETURN QUERY SELECT 'second submit while pending → blocked'::text, 'update_pending'::text, 'allowed'::text, FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'second submit while pending → blocked'::text, 'update_pending'::text,
      CASE WHEN SQLERRM LIKE '%update_pending%' THEN 'update_pending' ELSE SQLERRM END, SQLERRM LIKE '%update_pending%';
  END;

  -- 6. staff full approve → items applied, badge cleared
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr;
  SELECT id INTO v_pi FROM public.reservation_pending_items WHERE update_id = v_pu AND review_state = 'pending' LIMIT 1;
  v_res := public.staff_review_reservation_update_v1(v_pu, NULL, 'טסט צוות',
    jsonb_build_array(jsonb_build_object('pending_item_id', v_pi, 'decision', 'approve')), NULL);
  SELECT COUNT(*), COALESCE(SUM(quantity),0) INTO v_cnt, v_qty FROM public.reservation_items WHERE reservation_id = r_appr;
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr;
  RETURN QUERY SELECT 'staff full approve → applied atomically, badge cleared'::text,
    'approved/2 items/3 qty/null'::text,
    (v_res->>'outcome') || '/' || v_cnt || ' items/' || v_qty || ' qty/' || CASE WHEN v_pu IS NULL THEN 'null' ELSE 'set' END,
    (v_res->>'outcome' = 'approved' AND v_cnt = 2 AND v_qty = 3 AND v_pu IS NULL);

  -- 7. INCREASE submitted on מאושר → pending; existing item qty unchanged
  v_res := public.student_submit_reservation_update_v1(r_appr, s_email,
    jsonb_build_array(jsonb_build_object('action','increase','item_id',v_item_old,'quantity',1)));
  SELECT quantity INTO v_qty FROM public.reservation_items WHERE id = v_item_old;
  RETURN QUERY SELECT 'increase submitted → existing item qty unchanged while pending'::text,
    'pending / qty 1'::text, (v_res->>'mode') || ' / qty ' || v_qty, (v_res->>'mode' = 'pending' AND v_qty = 1);

  -- 8. increase approved → qty bumped
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr;
  SELECT id INTO v_pi FROM public.reservation_pending_items WHERE update_id = v_pu AND review_state = 'pending' LIMIT 1;
  v_res := public.staff_review_reservation_update_v1(v_pu, NULL, 'טסט צוות',
    jsonb_build_array(jsonb_build_object('pending_item_id', v_pi, 'decision', 'approve')), NULL);
  SELECT quantity INTO v_qty FROM public.reservation_items WHERE id = v_item_old;
  RETURN QUERY SELECT 'increase approved → target item quantity bumped'::text,
    'approved / qty 2'::text, (v_res->>'outcome') || ' / qty ' || v_qty, (v_res->>'outcome' = 'approved' AND v_qty = 2);

  -- 9. third update → update_limit (r_appr used 2/2)
  BEGIN
    v_res := public.student_submit_reservation_update_v1(r_appr, s_email,
      jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq1,'quantity',1)));
    RETURN QUERY SELECT 'third update → blocked (2-cap)'::text, 'update_limit'::text, 'allowed'::text, FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'third update → blocked (2-cap)'::text, 'update_limit'::text,
      CASE WHEN SQLERRM LIKE '%update_limit%' THEN 'update_limit' ELSE SQLERRM END, SQLERRM LIKE '%update_limit%';
  END;

  -- 10. removal does NOT touch the update counter
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_item_updates WHERE reservation_id = r_pend;
  PERFORM public.student_modify_reservation_item_v1(r_pend,
    (SELECT id FROM public.reservation_items WHERE reservation_id = r_pend AND equipment_id = eq2 LIMIT 1),
    'remove', s_email);
  SELECT COUNT(*) INTO v_qty FROM public.reservation_item_updates WHERE reservation_id = r_pend;
  RETURN QUERY SELECT 'removal via student_modify does not consume an update'::text,
    v_cnt::text, v_qty::text, v_cnt = v_qty;

  -- 11. reject an ADD → original list untouched, outcome rejected (own window +8..+9)
  INSERT INTO public.reservations_new (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_appr2, s_email, 'טסט', 'מאושר', 'פרטית', CURRENT_DATE + 8, '09:00', CURRENT_DATE + 9, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity) VALUES (r_appr2, eq1, 'טסט עדכון 1', 2)
  RETURNING id INTO v_item_old;
  v_res := public.student_submit_reservation_update_v1(r_appr2, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',1)));
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr2;
  SELECT id INTO v_pi FROM public.reservation_pending_items WHERE update_id = v_pu AND review_state = 'pending' LIMIT 1;
  v_res := public.staff_review_reservation_update_v1(v_pu, NULL, 'טסט צוות',
    jsonb_build_array(jsonb_build_object('pending_item_id', v_pi, 'decision', 'reject')), 'לא זמין');
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_items WHERE reservation_id = r_appr2;
  RETURN QUERY SELECT 'add rejected → original list untouched (1 item), outcome rejected'::text,
    'rejected / 1 item'::text, (v_res->>'outcome') || ' / ' || v_cnt || ' item',
    (v_res->>'outcome' = 'rejected' AND v_cnt = 1);

  -- 12. reduced-quantity approve → outcome partial
  v_res := public.student_submit_reservation_update_v1(r_appr2, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',2)));
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_appr2;
  SELECT id INTO v_pi FROM public.reservation_pending_items WHERE update_id = v_pu AND review_state = 'pending' LIMIT 1;
  v_res := public.staff_review_reservation_update_v1(v_pu, NULL, 'טסט צוות',
    jsonb_build_array(jsonb_build_object('pending_item_id', v_pi, 'decision', 'approve', 'approved_quantity', 1)), NULL);
  SELECT COALESCE(SUM(quantity),0) INTO v_qty FROM public.reservation_items WHERE reservation_id = r_appr2 AND equipment_id = eq2;
  RETURN QUERY SELECT 'reduced-quantity approve → outcome partial, reduced qty applied'::text,
    'partial / qty 1'::text, (v_res->>'outcome') || ' / qty ' || v_qty,
    (v_res->>'outcome' = 'partial' AND v_qty = 1);

  -- 13. staff_message stored on the ledger
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_item_updates
   WHERE reservation_id = r_appr2 AND review_status = 'rejected' AND staff_message = 'לא זמין';
  RETURN QUERY SELECT 'staff message persisted on the reviewed update'::text, '1'::text, v_cnt::text, v_cnt = 1;

  -- 14. external-loan restriction blocks add
  BEGIN
    v_res := public.student_submit_reservation_update_v1(r_pend, s_email,
      jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq3,'quantity',1)));
    RETURN QUERY SELECT 'external-restricted item cannot be added to a private loan'::text,
      'external_restricted'::text, 'allowed'::text, FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'external-restricted item cannot be added to a private loan'::text,
      'external_restricted'::text,
      CASE WHEN SQLERRM LIKE '%external_restricted%' THEN 'external_restricted' ELSE SQLERRM END,
      SQLERRM LIKE '%external_restricted%';
  END;

  -- 15. private-4 cap enforced on the hypothetical post-change list
  BEGIN
    v_res := public.student_submit_reservation_update_v1(r_pend, s_email,
      jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',4)));
    RETURN QUERY SELECT 'private loan capped at 4 items on update'::text, 'private_limit'::text, 'allowed'::text, FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'private loan capped at 4 items on update'::text, 'private_limit'::text,
      CASE WHEN SQLERRM LIKE '%private_limit%' THEN 'private_limit' ELSE SQLERRM END, SQLERRM LIKE '%private_limit%';
  END;

  -- 16. loan started while update pending → student blocked; review auto-closes
  INSERT INTO public.reservations_new (id, email, student_name, status, loan_type, borrow_date, borrow_time, return_date, return_time)
  VALUES (r_started, s_email, 'טסט', 'מאושר', 'פרטית', CURRENT_DATE + 5, '09:00', CURRENT_DATE + 6, '17:00');
  INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity) VALUES (r_started, eq1, 'טסט עדכון 1', 1);
  v_res := public.student_submit_reservation_update_v1(r_started, s_email,
    jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',1)));
  UPDATE public.reservations_new SET borrow_date = CURRENT_DATE - 1, return_date = CURRENT_DATE + 1 WHERE id = r_started;
  BEGIN
    v_res := public.student_submit_reservation_update_v1(r_started, s_email,
      jsonb_build_array(jsonb_build_object('action','add','equipment_id',eq2,'quantity',1)));
    v_err := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_err := CASE WHEN SQLERRM LIKE '%already_started%' OR SQLERRM LIKE '%update_pending%' THEN 'blocked' ELSE SQLERRM END;
  END;
  SELECT pending_update_id INTO v_pu FROM public.reservations_new WHERE id = r_started;
  SELECT id INTO v_pi FROM public.reservation_pending_items WHERE update_id = v_pu AND review_state = 'pending' LIMIT 1;
  v_res := public.staff_review_reservation_update_v1(v_pu, NULL, 'טסט צוות',
    jsonb_build_array(jsonb_build_object('pending_item_id', v_pi, 'decision', 'approve')), NULL);
  SELECT COUNT(*) INTO v_cnt FROM public.reservation_items WHERE reservation_id = r_started;
  RETURN QUERY SELECT 'loan started while update pending → student blocked, review auto-cancels, nothing applied'::text,
    'blocked / cancelled_started / 1 item'::text,
    v_err || ' / ' || (v_res->>'outcome') || ' / ' || v_cnt || ' item',
    (v_err = 'blocked' AND v_res->>'outcome' = 'cancelled_started' AND v_cnt = 1);

  DELETE FROM public.reservations_new WHERE id LIKE 'test-upd-res-%';
  DELETE FROM public.equipment WHERE id LIKE 'test-upd-eq-%';
  DELETE FROM public.activity_logs WHERE entity_id LIKE 'test-upd-res-%';
END;
$function$;

REVOKE ALL ON FUNCTION public.run_reservation_update_tests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_reservation_update_tests() TO service_role;
