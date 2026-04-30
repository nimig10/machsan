-- Final teardown of the legacy blob store. Every domain entity now lives
-- in its own dedicated table (Stages 5-13). The only row remaining in
-- public.store was `backup_equipment` — a stale snapshot from before
-- equipment was normalized; it's been preserved in store_snapshots history
-- if anyone needs it for archaeology, but no live code reads or writes it.
--
-- This migration removes:
--   - public.store table (with its 2 triggers: trg_store_shrink_guard, trg_kits_content_guard)
--   - public.store_snapshots table (autosaved snapshots from the shrink guard)
--   - store_shrink_guard()                 (trigger fn — only fired on store)
--   - kits_content_guard()                 (trigger fn — only fired on store)
--   - is_protected_store_key(text)         (used by the trigger above)
--   - prune_store_snapshots(int)           (cron RPC — table is gone)
--   - DDL event trigger that locked guard functions (no longer needed)
--
-- After this migration, /api/store and /api/prune-snapshots will return
-- 500 — both endpoints are deleted in the same commit.

-- 1) Disable the DDL guards from migrations 017 / 017_lock_guard_functions
--    (these protect guard functions from being dropped — we're undoing that
--    protection deliberately, since the guards no longer guard anything).
DROP EVENT TRIGGER IF EXISTS trg_protect_guard_ddl   CASCADE;
DROP EVENT TRIGGER IF EXISTS lock_guard_functions_drop CASCADE;
DROP FUNCTION IF EXISTS public.protect_guard_ddl()   CASCADE;

-- 2) Drop tables (CASCADE removes the triggers attached to them)
DROP TABLE IF EXISTS public.store          CASCADE;
DROP TABLE IF EXISTS public.store_snapshots CASCADE;

-- 3) Drop trigger/RPC functions that only operated on those tables
DROP FUNCTION IF EXISTS public.store_shrink_guard()         CASCADE;
DROP FUNCTION IF EXISTS public.kits_content_guard()         CASCADE;
DROP FUNCTION IF EXISTS public.is_protected_store_key(text) CASCADE;
DROP FUNCTION IF EXISTS public.prune_store_snapshots(int)   CASCADE;
