-- save_edited_reservation_v1 — "save an edited reservation", atomically.
--
-- THE BUG THIS EXISTS FOR
-- saveEditedReservation used to spend three separate round trips: UPDATE the
-- row in reservations_new, DELETE every reservation_items row belonging to it,
-- then INSERT the new list. Each one is its own transaction. A failure — or a
-- dropped connection, which is the likely one on a phone — between the DELETE
-- and the INSERT left the request alive and edited but WITH NO GEAR ON IT AT
-- ALL, and nothing in the app could tell that apart from a request whose items
-- were legitimately cleared. One plpgsql body is one transaction: all three
-- land, or none do.
--
-- SECURITY INVOKER, DELIBERATELY
-- The job here is atomicity, not authority. The function must be reachable by
-- exactly whoever could already run those three statements by hand, and must be
-- stopped by exactly the same RLS. A SECURITY DEFINER version would hand every
-- caller the power to rewrite any reservation in the system — a far larger
-- change than the bug being fixed, and one nobody asked for. For the same
-- reason EXECUTE is granted to anon as well: under INVOKER that grants no
-- ability the role does not already have, and withholding it would narrow the
-- surface relative to today rather than leave it untouched.
--
-- COLUMN SEMANTICS MIRROR supabase-js
-- postgrest drops `undefined` keys from an .update() payload, so a field the
-- caller does not mention keeps its stored value. Every column below therefore
-- sits behind a jsonb_exists() guard instead of a plain assignment: a caller
-- that omits student_name must not blank it. A key present with an explicit
-- null still writes NULL, which is how project_name / overdue_student_note are
-- cleared today.
--
-- This matters most for `original_items` (lesson #35+#44): it is the frozen
-- snapshot of what actually went out, stamped once by the overdue partial-
-- return flow and never re-derived. Under these semantics an edit that does not
-- mention it cannot erase it — strictly safer than the old UPDATE, which wrote
-- `?? null` unconditionally.
--
-- p_items carries the same distinction one level up: SQL NULL means "items are
-- not part of this edit", while an array — INCLUDING an empty one — means
-- "replace the list with exactly this". Quantities are clamped to >= 1 so the
-- CHECK (quantity > 0) can never be tripped, matching the client's `|| 1`
-- (lesson #35+#44 — zero-quantity rows would break ~25 render sites).
--
-- jsonb_exists(...) is spelled out rather than the `?` operator so no driver
-- can mistake it for a bind placeholder.

CREATE OR REPLACE FUNCTION public.save_edited_reservation_v1(
  p_reservation_id TEXT,
  p_fields         JSONB,
  p_items          JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows        INTEGER;
  v_items_count INTEGER := 0;
BEGIN
  IF p_reservation_id IS NULL OR p_reservation_id = '' THEN
    RAISE EXCEPTION 'save_edited_reservation_v1: p_reservation_id is required';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'save_edited_reservation_v1: p_fields must be a JSON object';
  END IF;
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'save_edited_reservation_v1: p_items must be a JSON array or null';
  END IF;

  UPDATE public.reservations_new SET
    student_name = CASE WHEN jsonb_exists(p_fields, 'student_name')
                        THEN p_fields->>'student_name' ELSE student_name END,
    email        = CASE WHEN jsonb_exists(p_fields, 'email')
                        THEN p_fields->>'email' ELSE email END,
    phone        = CASE WHEN jsonb_exists(p_fields, 'phone')
                        THEN p_fields->>'phone' ELSE phone END,
    course       = CASE WHEN jsonb_exists(p_fields, 'course')
                        THEN p_fields->>'course' ELSE course END,
    project_name = CASE WHEN jsonb_exists(p_fields, 'project_name')
                        THEN p_fields->>'project_name' ELSE project_name END,
    loan_type    = CASE WHEN jsonb_exists(p_fields, 'loan_type')
                        THEN p_fields->>'loan_type' ELSE loan_type END,
    borrow_date  = CASE WHEN jsonb_exists(p_fields, 'borrow_date')
                        THEN NULLIF(p_fields->>'borrow_date', '')::DATE ELSE borrow_date END,
    return_date  = CASE WHEN jsonb_exists(p_fields, 'return_date')
                        THEN NULLIF(p_fields->>'return_date', '')::DATE ELSE return_date END,
    borrow_time  = CASE WHEN jsonb_exists(p_fields, 'borrow_time')
                        THEN p_fields->>'borrow_time' ELSE borrow_time END,
    return_time  = CASE WHEN jsonb_exists(p_fields, 'return_time')
                        THEN p_fields->>'return_time' ELSE return_time END,
    overdue_student_note = CASE WHEN jsonb_exists(p_fields, 'overdue_student_note')
                        THEN p_fields->>'overdue_student_note' ELSE overdue_student_note END,
    -- jsonb 'null' arrives as a JSON null, not SQL NULL; normalize so the
    -- column stays truly empty and `original_items ?? items` keeps working.
    original_items = CASE
                       WHEN NOT jsonb_exists(p_fields, 'original_items') THEN original_items
                       WHEN jsonb_typeof(p_fields->'original_items') = 'null' THEN NULL
                       ELSE p_fields->'original_items'
                     END
  WHERE id = p_reservation_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Either the row is gone or RLS hid it from this caller. The old client
    -- code could not tell: postgrest reports a zero-row UPDATE as success, so
    -- the edit silently evaporated and the UI said "הבקשה עודכנה".
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  IF p_items IS NOT NULL THEN
    DELETE FROM public.reservation_items WHERE reservation_id = p_reservation_id;

    INSERT INTO public.reservation_items (reservation_id, equipment_id, name, quantity, unit_id)
    SELECT
      p_reservation_id,
      NULLIF(it->>'equipment_id', ''),
      COALESCE(it->>'name', ''),
      GREATEST(1, COALESCE(NULLIF(it->>'quantity', '')::INTEGER, 1)),
      NULLIF(it->>'unit_id', '')
    FROM jsonb_array_elements(p_items) AS it;

    GET DIAGNOSTICS v_items_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'reservation_id', p_reservation_id,
    'items_written',  v_items_count,
    'items_replaced', p_items IS NOT NULL
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_edited_reservation_v1(TEXT, JSONB, JSONB)
  TO anon, authenticated, service_role;

-- Verify after apply:
--   SELECT prosecdef FROM pg_proc WHERE proname='save_edited_reservation_v1';
--   -- expect false (INVOKER)
