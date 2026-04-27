-- Stage 7 cleanup — public.lecturers is now the source of truth for lecturer
-- records. The store.lecturers JSONB blob has no remaining writers or readers
-- in the codebase (Sessions A + B flipped them all).
--
-- This migration:
--   1. Removes 'lecturers' from is_protected_store_key() so the shrink guard
--      stops watching it (the row is being deleted next).
--   2. DELETEs the row from public.store. The blob's content is already
--      mirrored to public.lecturers; the table is the canonical record.
--
-- Idempotent: re-running is a no-op (CREATE OR REPLACE + DELETE WHERE).

CREATE OR REPLACE FUNCTION is_protected_store_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studios','studio_bookings','studioBookings',
    'lessons','teamMembers','categories','students',
    'certifications'
  ]);
$$;

DELETE FROM public.store WHERE key = 'lecturers';
