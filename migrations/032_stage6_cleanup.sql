-- 032_stage6_cleanup.sql
-- Stage 6 step 8: drop transitional column + blob row.
--
-- students.track_name was a transitional column kept while the app still
-- read from it. After step 6 all reads go through the tracks FK join and
-- all writes use track_id only. Safe to drop.
--
-- store.certifications blob is no longer written by the app (step 6).
-- The normalized tables are the source of truth. Remove the stale row.

-- ① Drop transitional column
ALTER TABLE public.students DROP COLUMN IF EXISTS track_name;

-- ② Remove stale certifications blob
-- (types/tracks/trackSettings were also stored here; all migrated to tables)
DELETE FROM public.store WHERE key = 'certifications';
