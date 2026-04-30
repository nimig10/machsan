-- Stage 13 Session C — retire the legacy config blobs in store.
-- Tables created in 20260430100000–130000 are now the source of truth.
-- The api/store.js RETIRED_KEYS gate (set in the same commit) blocks any
-- future POST with these keys so the rows cannot reappear.
--
-- Cleanup categories:
--   1) MIGRATED: data is now in tables (policies, siteSettings, collegeManager, deptHeads, managerToken)
--   2) DEAD:     orphaned data with zero code references (deptHead singular, calendarToken)
--   3) STALE:    auto-backups for keys already retired in earlier stages (Stage 11)
--
-- is_protected_store_key remains [equipment, students, certifications] —
-- none of the deleted keys were protected, so the shrink_guard will not fire.

DELETE FROM public.store
WHERE key IN (
  -- Migrated to dedicated tables in Stage 13
  'policies',
  'siteSettings',
  'collegeManager',
  'deptHeads',
  'managerToken',
  -- Dead data (zero code references)
  'deptHead',         -- legacy singular form, never read by current code
  'calendarToken',    -- removed feature, only a placeholder value remains
  -- Stale auto-backups for keys retired in Stage 11
  'backup_kits',
  'backup_teamMembers',
  'backup_reservations'
);
