-- Stage 10 Session C — public.studio_bookings is now the source of truth.
-- Reads were flipped in Session B; this migration retires the legacy blob:
--   1. delete the store.studio_bookings row,
--   2. drop 'studio_bookings' from is_protected_store_key (no longer needs guard).
--
-- The api/store.js RETIRED_KEYS gate (set in the same PR) blocks any future
-- POST attempt with key='studio_bookings' so the row cannot reappear.

DELETE FROM public.store WHERE key = 'studio_bookings';

CREATE OR REPLACE FUNCTION public.is_protected_store_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studioBookings',  -- legacy camelCase, retired since Stage 9 housekeeping
    'teamMembers','categories','students',
    'certifications'
    -- removed: 'studio_bookings' (Stage 10-C — public.studio_bookings is SoT)
  ]);
$function$;
