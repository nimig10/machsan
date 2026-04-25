-- ============================================================================
-- Migration 006: check_migration_drift — health check for dual-write mirror
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   One-shot diagnostic. Compares row counts between the authoritative JSON
--   blobs (store.equipment, store.reservations) and the mirrored normalized
--   tables (equipment, reservations_new). Returns a JSON report and a
--   top-level status so you can tell at a glance whether the mirror is
--   healthy or has drifted.
--
-- USAGE (Supabase SQL Editor):
--   SELECT public.check_migration_drift();
--
-- OUTPUT:
--   {
--     "status": "OK" | "DRIFT",
--     "checked_at": "2026-04-16T...",
--     "equipment":    { store_count, table_count, drift, last_table_sync, status },
--     "reservations": { store_count, table_count, drift, last_table_sync, status }
--   }
--
-- INTERPRETATION:
--   * status = "OK"                    → counts match, mirror healthy.
--   * status = "DRIFT"                 → counts don't match; investigate.
--   * last_table_sync > ~1h old        → no recent edits; not a bug per se.
--   * drift = +N (store > table)       → N writes reached store but not table
--                                        (mirror failed — check Vercel logs).
--   * drift = -N (table > store)       → orphaned rows in new tables; needs
--                                        manual cleanup before stage 5.
--
-- SAFETY:
--   Read-only. Pure CREATE OR REPLACE. Safe to re-run.
-- ----------------------------------------------------------------------------
-- Created: 2026-04-16
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_migration_drift()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_store_eq_count   INTEGER;
  v_store_res_count  INTEGER;
  v_table_eq_count   INTEGER;
  v_table_res_count  INTEGER;
  v_last_eq_sync     TIMESTAMPTZ;
  v_last_res_sync    TIMESTAMPTZ;
  v_eq_status        TEXT;
  v_res_status       TEXT;
  v_overall_status   TEXT;
BEGIN
  -- JSON blob counts
  SELECT COALESCE(jsonb_array_length(data), 0) INTO v_store_eq_count
    FROM public.store WHERE key = 'equipment';

  SELECT COALESCE(jsonb_array_length(data), 0) INTO v_store_res_count
    FROM public.store WHERE key = 'reservations';

  -- Normalized table counts
  SELECT COUNT(*) INTO v_table_eq_count  FROM public.equipment;
  SELECT COUNT(*) INTO v_table_res_count FROM public.reservations_new;

  -- Most recent sync timestamps
  SELECT MAX(updated_at) INTO v_last_eq_sync  FROM public.equipment;
  SELECT MAX(updated_at) INTO v_last_res_sync FROM public.reservations_new;

  v_eq_status   := CASE WHEN v_store_eq_count  = v_table_eq_count  THEN 'OK' ELSE 'DRIFT' END;
  v_res_status  := CASE WHEN v_store_res_count = v_table_res_count THEN 'OK' ELSE 'DRIFT' END;
  v_overall_status :=
    CASE WHEN v_eq_status = 'OK' AND v_res_status = 'OK' THEN 'OK' ELSE 'DRIFT' END;

  RETURN jsonb_build_object(
    'status',     v_overall_status,
    'checked_at', NOW(),
    'equipment', jsonb_build_object(
      'store_count',     v_store_eq_count,
      'table_count',     v_table_eq_count,
      'drift',           v_store_eq_count - v_table_eq_count,
      'last_table_sync', v_last_eq_sync,
      'status',          v_eq_status
    ),
    'reservations', jsonb_build_object(
      'store_count',     v_store_res_count,
      'table_count',     v_table_res_count,
      'drift',           v_store_res_count - v_table_res_count,
      'last_table_sync', v_last_res_sync,
      'status',          v_res_status
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.check_migration_drift() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_migration_drift() FROM anon;
REVOKE ALL ON FUNCTION public.check_migration_drift() FROM authenticated;

COMMENT ON FUNCTION public.check_migration_drift() IS
  'Returns JSON report comparing store.equipment/reservations JSON blobs vs equipment/reservations_new tables. status=OK means mirror is in sync. See migration 006.';
