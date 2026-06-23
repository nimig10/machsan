-- ============================================================================
-- sync_equipment_from_json — persist external-loan restriction columns
-- ----------------------------------------------------------------------------
-- Extends the equipment upsert to mirror the two new equipment columns added in
-- 20260623120000:
--   * external_loan_restricted  ← JSON key 'externalLoanRestricted' (camelCase)
--   * external_loan_hold_count  ← JSON key 'externalLoanHoldCount'  (camelCase)
--
-- Everything else (units delete+reinsert, available_units recompute, prune) is
-- byte-for-byte identical to migration 005. Pure CREATE OR REPLACE — safe to
-- re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_equipment_from_json(p_equipment JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids_kept  TEXT[];
  v_deleted   INTEGER;
  v_upserted  INTEGER := 0;
BEGIN
  IF p_equipment IS NULL OR jsonb_typeof(p_equipment) <> 'array' THEN
    RAISE EXCEPTION 'sync_equipment_from_json: p_equipment must be a JSON array';
  END IF;

  -- Collect all ids present in the input array
  SELECT COALESCE(array_agg(e->>'id'), ARRAY[]::TEXT[])
    INTO v_ids_kept
  FROM jsonb_array_elements(p_equipment) AS e
  WHERE e->>'id' IS NOT NULL;

  -- ── UPSERT each equipment row ─────────────────────────────────────────────
  INSERT INTO public.equipment (
    id, name, category, image, notes, description, technical_details,
    status, photo_only, sound_only, private_loan_unlimited, certification_id,
    total_quantity, available_units,
    external_loan_restricted, external_loan_hold_count,
    updated_at
  )
  SELECT
    e->>'id',
    COALESCE(e->>'name', ''),
    e->>'category',
    e->>'image',
    COALESCE(e->>'notes', ''),
    COALESCE(e->>'description', ''),
    COALESCE(e->>'technical_details', ''),
    COALESCE(e->>'status', 'תקין'),
    COALESCE((e->>'photoOnly')::BOOLEAN,              FALSE),
    COALESCE((e->>'soundOnly')::BOOLEAN,              FALSE),
    COALESCE((e->>'privateLoanUnlimited')::BOOLEAN,   FALSE),
    NULLIF(e->>'certification_id', ''),
    COALESCE((e->>'total_quantity')::INTEGER, 0),
    0,   -- recomputed below after units are written
    COALESCE((e->>'externalLoanRestricted')::BOOLEAN, FALSE),
    COALESCE((e->>'externalLoanHoldCount')::INTEGER,  0),
    NOW()
  FROM jsonb_array_elements(p_equipment) AS e
  WHERE e->>'id' IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    name                     = EXCLUDED.name,
    category                 = EXCLUDED.category,
    image                    = EXCLUDED.image,
    notes                    = EXCLUDED.notes,
    description              = EXCLUDED.description,
    technical_details        = EXCLUDED.technical_details,
    status                   = EXCLUDED.status,
    photo_only               = EXCLUDED.photo_only,
    sound_only               = EXCLUDED.sound_only,
    private_loan_unlimited   = EXCLUDED.private_loan_unlimited,
    certification_id         = EXCLUDED.certification_id,
    total_quantity           = EXCLUDED.total_quantity,
    external_loan_restricted = EXCLUDED.external_loan_restricted,
    external_loan_hold_count = EXCLUDED.external_loan_hold_count,
    updated_at               = NOW();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- ── Replace units for the affected equipment (delete + re-insert) ─────────
  DELETE FROM public.equipment_units
    WHERE equipment_id = ANY(v_ids_kept);

  INSERT INTO public.equipment_units (id, equipment_id, status, fault, repair, updated_at)
  SELECT
    unit->>'id',
    e->>'id',
    COALESCE(unit->>'status', 'תקין'),
    COALESCE(unit->>'fault',  ''),
    COALESCE(unit->>'repair', ''),
    NOW()
  FROM jsonb_array_elements(p_equipment) AS e,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(e->'units') = 'array' THEN e->'units' ELSE '[]'::JSONB END
       ) AS unit
  WHERE e->>'id' IS NOT NULL
    AND unit->>'id' IS NOT NULL;

  -- ── Recompute available_units ─────────────────────────────────────────────
  -- (identical to migration 005 — overall availability, loan-type-agnostic)
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
  WHERE eq.id = ANY(v_ids_kept);

  -- ── Remove equipment no longer in the source array ────────────────────────
  DELETE FROM public.equipment
    WHERE NOT (id = ANY(v_ids_kept));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'deleted',  v_deleted,
    'total_in', jsonb_array_length(p_equipment)
  );
END $$;

REVOKE ALL ON FUNCTION public.sync_equipment_from_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_equipment_from_json(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.sync_equipment_from_json(JSONB) FROM authenticated;

COMMENT ON FUNCTION public.sync_equipment_from_json(JSONB) IS
  'State-based dual-write mirror. Accepts full equipment array, upserts into equipment + equipment_units (incl. external_loan_restricted / external_loan_hold_count), recomputes available_units, deletes rows not present. Called by /api/sync-equipment (service_role).';
