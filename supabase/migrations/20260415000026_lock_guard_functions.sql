-- Migration: 027_lock_guard_functions
-- Applied remotely: 2026-04-19 09:31:28 UTC
-- Supabase tracking version: 20260419093128 (stored as "017_lock_guard_functions")
--
-- CONTEXT:
-- Prevent silent DROP/ALTER of the shrink-guard infrastructure.
-- Root cause of 2026-04-19 students wipe: is_protected_store_key had been
-- overwritten via a manual SQL Editor CREATE OR REPLACE. This event trigger
-- catches any attempt to drop the guard functions and raises P0001. It does
-- NOT block CREATE OR REPLACE (we need that for legit migrations), but the
-- pairing with migration 011's trigger means the guard logic stays wired up.
--
-- KNOWN GAP: CREATE OR REPLACE with a narrower body is still possible.
-- Future migration should add a verification trigger that checks the function
-- body signature after every DDL event.
--
-- NOTE: This migration is already applied on the remote DB. This file exists
-- in the repo for audit/history purposes.

CREATE OR REPLACE FUNCTION protect_guard_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj RECORD;
  v_protected_names TEXT[] := ARRAY[
    'is_protected_store_key',
    'store_shrink_guard',
    'kits_content_guard'
  ];
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type = 'function'
       AND obj.schema_name = 'public'
       AND split_part(obj.object_identity, '(', 1) = ANY(
         SELECT 'public.' || n FROM unnest(v_protected_names) n
       )
    THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Refusing to drop guard function %s. '
          'These functions protect against silent data loss. '
          'If you really need to drop one, first DROP EVENT TRIGGER trg_protect_guard_ddl.',
          obj.object_identity
        ),
        ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_protect_guard_ddl;
CREATE EVENT TRIGGER trg_protect_guard_ddl
  ON sql_drop
  EXECUTE FUNCTION protect_guard_ddl();
