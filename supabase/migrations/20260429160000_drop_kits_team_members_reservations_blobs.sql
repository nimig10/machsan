-- Stage 11 Session C — public.kits and public.team_members are now the
-- source of truth. Reads were flipped in Session B; this migration retires
-- the legacy blobs:
--   1. delete store rows for kits, teamMembers, and reservations,
--   2. remove the three keys from is_protected_store_key (no longer guarded).
--
-- The api/store.js RETIRED_KEYS gate (set in the same commit) blocks any
-- future POST with these keys so the rows cannot reappear.

DELETE FROM public.store WHERE key IN ('kits', 'teamMembers', 'reservations');

-- Remove kits, teamMembers, reservations from the shrink-guard allowlist.
-- studios and studio_bookings were already removed in their own stage migrations.
CREATE OR REPLACE FUNCTION public.is_protected_store_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_key = ANY(ARRAY[
    'equipment',
    'categories',
    'students',
    'certifications'
  ]);
$function$;
