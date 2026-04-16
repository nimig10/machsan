-- ============================================================================
-- Migration 005: sync_equipment_from_json — mirror full equipment array
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Dual-write mirror. When the app calls storageSet('equipment', array),
--   the same array is also sent here, which UPSERTs it into equipment +
--   equipment_units, recomputes available_units, and prunes deleted rows.
--
-- WHY NOT INSERT PER ITEM:
--   Full-array sync is idempotent and handles adds, edits, deletions and unit
--   status changes in one shot — same pattern as sync_reservations_from_json.
--
-- SAFETY:
--   * Only operates on new tables (equipment, equipment_units).
--   * Does NOT touch `store`.
--   * Pure CREATE OR REPLACE FUNCTION. Safe to re-run.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
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
    total_quantity, available_units, updated_at
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
    NOW()
  FROM jsonb_array_elements(p_equipment) AS e
  WHERE e->>'id' IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    name                   = EXCLUDED.name,
    category               = EXCLUDED.category,
    image                  = EXCLUDED.image,
    notes                  = EXCLUDED.notes,
    description            = EXCLUDED.description,
    technical_details      = EXCLUDED.technical_details,
    status                 = EXCLUDED.status,
    photo_only             = EXCLUDED.photo_only,
    sound_only             = EXCLUDED.sound_only,
    private_loan_unlimited = EXCLUDED.private_loan_unlimited,
    certification_id       = EXCLUDED.certification_id,
    total_quantity         = EXCLUDED.total_quantity,
    updated_at             = NOW();

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
  -- healthy units  = units with status = 'תקין'
  -- reserved qty   = open reservations (not returned/cancelled) CURRENTLY ACTIVE
  --                  i.e. borrow_date <= today AND return_date >= today.
  --                  Future reservations don't reduce availability today.
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
              AND r.status NOT IN ('הוחזר', 'בוטל', 'מבוטל')
              AND r.borrow_date <= CURRENT_DATE
              AND r.return_date >= CURRENT_DATE
          ), 0
        ),
        0
      ),
      updated_at = NOW()
  WHERE eq.id = ANY(v_ids_kept);

  -- ── Remove equipment no longer in the source array ────────────────────────
  -- CASCADE will delete their equipment_units automatically.
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
  'State-based dual-write mirror. Accepts full equipment array, upserts into equipment + equipment_units, recomputes available_units, deletes rows not present. Called by /api/sync-equipment (service_role) on every storageSet(equipment). See migration 005.';
