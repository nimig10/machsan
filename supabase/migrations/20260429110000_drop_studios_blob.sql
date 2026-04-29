-- Stage 9 Session C — public.studios is now the source of truth.
-- Reads were flipped in Session B; this migration retires the legacy blob:
--   1. delete the store.studios row,
--   2. drop 'studios' from is_protected_store_key (no longer needs guard).
--
-- The api/store.js RETIRED_KEYS gate (set in the same PR) blocks any future
-- POST attempt with key='studios' so the row cannot reappear.

DELETE FROM public.store WHERE key = 'studios';

CREATE OR REPLACE FUNCTION public.is_protected_store_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studio_bookings','studioBookings',
    'teamMembers','categories','students',
    'certifications'
  ]);
$function$;
