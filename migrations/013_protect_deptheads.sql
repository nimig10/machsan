-- ============================================================================
-- Migration 013: Add `deptHeads` to the protected-key set
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Migration 011 installed `store_shrink_guard` but missed the `deptHeads`
--   key. Verified in production 2026-04-16:
--     SELECT key, is_protected_store_key(key) FROM public.store ...
--   returned deptHeads → protected=false. That is the exact same class of
--   data that got silently wiped on 2026-04-16 (user-maintained list; two
--   admins can race and one can overwrite the other with a stale blob).
--
-- CHANGE:
--   Extend `is_protected_store_key` to include 'deptHeads'. No other changes.
--   The trigger itself doesn't need to be redefined; it calls this function
--   on every UPDATE, so the new key is picked up immediately.
--
-- SAFETY:
--   * CREATE OR REPLACE — fully re-runnable.
--   * deptHeads only has 1 row today, but the guard only blocks >10% +
--     >1 row shrinks. A single legitimate delete still passes.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_protected_store_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studios','studio_bookings','studioBookings',
    'lessons','lecturers','teamMembers','categories','students',
    'deptHeads'
  ]);
$$;

-- Verification:
--   SELECT is_protected_store_key('deptHeads');   -- expect: true
--   SELECT key, is_protected_store_key(key)
--   FROM public.store
--   WHERE jsonb_typeof(data) = 'array'
--   ORDER BY key;
