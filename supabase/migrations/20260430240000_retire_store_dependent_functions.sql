-- 20260430240000_retire_store_dependent_functions.sql
--
-- Migration 20260430220000 dropped public.store but four functions still
-- referenced it, so every call raised "relation public.store does not exist":
--
--   1. delete_reservation_v1   — invoked by /api/delete-reservation (BROKEN)
--   2. mark_overdue_email_sent — invoked by /api/mark-overdue-sent (BROKEN)
--   3. append_to_store_reservations — orphan, no caller
--   4. check_migration_drift   — diagnostic, blob is gone so always errors
--
-- This migration:
--   * Rewrites #1 and #2 to use the normalized tables (reservations_new,
--     reservation_items, equipment, equipment_units) — no public.store reads.
--   * Drops #3 and #4 entirely.

-- ─── 1. delete_reservation_v1 — strip public.store reads ──────────────────
CREATE OR REPLACE FUNCTION public.delete_reservation_v1(p_reservation_id text)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_equipment_ids      TEXT[];
  v_normalized_deleted INT := 0;
  v_items_deleted      INT := 0;
  v_source             TEXT;
  v_recomputed         INT := 0;
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
  END IF;

  SELECT ARRAY_AGG(DISTINCT equipment_id::TEXT)
    INTO v_equipment_ids
  FROM public.reservation_items
  WHERE reservation_id = p_reservation_id;

  WITH d_items AS (
    DELETE FROM public.reservation_items
    WHERE reservation_id = p_reservation_id
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_items_deleted FROM d_items;

  WITH d_res AS (
    DELETE FROM public.reservations_new
    WHERE id = p_reservation_id
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_normalized_deleted FROM d_res;

  v_source := CASE WHEN v_normalized_deleted > 0 THEN 'normalized' ELSE 'not_found' END;

  IF v_equipment_ids IS NOT NULL AND array_length(v_equipment_ids, 1) > 0 THEN
    UPDATE public.equipment eq
    SET available_units = GREATEST(
          (
            SELECT COUNT(*) FROM public.equipment_units u
            WHERE u.equipment_id = eq.id AND u.status = 'תקין'
          )
          - COALESCE((
              SELECT SUM(ri.quantity)
              FROM public.reservation_items ri
              JOIN public.reservations_new r ON r.id = ri.reservation_id
              WHERE ri.equipment_id = eq.id
                AND (
                  r.status IN ('באיחור','פעילה')
                  OR (
                    r.status = 'מאושר'
                    AND r.borrow_date IS NOT NULL
                    AND (r.borrow_date + COALESCE(NULLIF(r.borrow_time,'')::TIME, '00:00'::TIME)) <= (NOW() AT TIME ZONE 'Asia/Jerusalem')
                  )
                )
            ), 0),
          0
        ),
        updated_at = NOW()
    WHERE eq.id::TEXT = ANY(v_equipment_ids);

    GET DIAGNOSTICS v_recomputed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'id', p_reservation_id,
    'source', v_source,
    'normalized_deleted', v_normalized_deleted,
    'items_deleted', v_items_deleted,
    'recomputed_equipment', v_recomputed
  );
END;
$function$;

-- ─── 2. mark_overdue_email_sent — write to normalized column ──────────────
CREATE OR REPLACE FUNCTION public.mark_overdue_email_sent(p_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.reservations_new
  SET overdue_email_sent = TRUE,
      updated_at = NOW()
  WHERE id = p_id;
$function$;

-- ─── 3 & 4. drop orphans ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.append_to_store_reservations(jsonb);
DROP FUNCTION IF EXISTS public.check_migration_drift();
