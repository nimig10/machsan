-- Migration: 026_restore_protected_key_list
-- Applied remotely: 2026-04-19 08:28:42 UTC
-- Supabase tracking version: 20260419082842 (stored as "016_restore_protected_key_list")
--
-- CONTEXT:
-- Root cause of 2026-04-19 students wipe:
-- is_protected_store_key had been overwritten with a narrow list missing
-- reservations, equipment, and certifications. store_shrink_guard returned
-- early before any snapshot or guard could run. Restoring the canonical list
-- from migration 015.
--
-- NOTE: This migration is already applied on the remote DB. This file exists
-- in the repo for audit/history purposes. Do NOT re-run via supabase db push
-- unless tracking is out of sync.

CREATE OR REPLACE FUNCTION is_protected_store_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studios','studio_bookings','studioBookings',
    'lessons','lecturers','teamMembers','categories','students',
    'certifications'
  ]);
$$;
