-- ============================================================================
-- Migration 015: extend shrink guard to protect certifications.students
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   The shrink guard (migration 011) only covers array-valued store keys.
--   certifications is object-valued: { types:[...], students:[...122 items...] }
--   A stale-cache write could silently wipe all 122 students with no block
--   and no snapshot — identical race condition to the 2026-04-16 incident.
--
-- CHANGES:
--   1. Add 'certifications' to is_protected_store_key()
--   2. Rewrite store_shrink_guard() to handle object keys with a known
--      sub-array (certifications.students). Same threshold as array keys:
--      > 10% AND > 1 row triggers a P0001 block + snapshot.
--   3. Snapshots for certifications now record prev/new length of the
--      students sub-array so forensics can tell what changed.
--
-- NOT CHANGED:
--   All existing array-key behavior is identical. Only certifications gets
--   new treatment. Other object keys (siteSettings, policies, etc.) still
--   pass through with a snapshot-only note.
-- ============================================================================

-- Step 1: Add certifications to the protected key list --------------------
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

-- Step 2: Extend the trigger function -------------------------------------
CREATE OR REPLACE FUNCTION store_shrink_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  SHRINK_THRESHOLD_PCT CONSTANT INT := 10;
  SHRINK_THRESHOLD_ABS CONSTANT INT := 1;
  v_old_len            INT;
  v_new_len            INT;
  v_allow_bypass       TEXT;
  v_shrink_pct         NUMERIC;
  v_note               TEXT := NULL;
  v_guard_label        TEXT;
BEGIN
  -- Only guard protected keys
  IF NOT is_protected_store_key(NEW.key) THEN
    RETURN NEW;
  END IF;

  -- Determine what to measure -----------------------------------------------
  IF jsonb_typeof(OLD.data) = 'array' AND jsonb_typeof(NEW.data) = 'array' THEN
    -- Standard array-valued key (kits, reservations, equipment, ...)
    v_old_len     := jsonb_array_length(OLD.data);
    v_new_len     := jsonb_array_length(NEW.data);
    v_guard_label := NEW.key;

  ELSIF NEW.key = 'certifications' THEN
    -- Object key: guard the students sub-array
    v_old_len     := jsonb_array_length(COALESCE(OLD.data->'students', '[]'::jsonb));
    v_new_len     := jsonb_array_length(COALESCE(NEW.data->'students', '[]'::jsonb));
    v_guard_label := 'certifications.students';

  ELSE
    -- Other object-valued keys (siteSettings, policies, etc.) — snapshot only
    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data, NULL, NULL, FALSE, 'object_no_guard');
    RETURN NEW;
  END IF;

  -- If list grew or stayed same — snapshot and allow -------------------------
  IF v_new_len >= v_old_len THEN
    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data, v_old_len, v_new_len, FALSE, 'grew_or_equal');
    RETURN NEW;
  END IF;

  -- Compute shrink percentage ------------------------------------------------
  IF v_old_len = 0 THEN
    v_shrink_pct := 0;
  ELSE
    v_shrink_pct := ((v_old_len - v_new_len)::NUMERIC / v_old_len) * 100;
  END IF;

  -- Bypass check -------------------------------------------------------------
  v_allow_bypass := current_setting('app.allow_store_bulk_shrink', TRUE);

  IF v_shrink_pct > SHRINK_THRESHOLD_PCT
     AND (v_old_len - v_new_len) > SHRINK_THRESHOLD_ABS
     AND COALESCE(v_allow_bypass, 'off') <> 'on'
  THEN
    v_note := format(
      'SHRINK GUARD: key=%s old=%s new=%s drop=%s%% (threshold=%s%%/%srows). '
      'Write refused. If intentional, set app.allow_store_bulk_shrink=on.',
      v_guard_label, v_old_len, v_new_len,
      round(v_shrink_pct,1), SHRINK_THRESHOLD_PCT, SHRINK_THRESHOLD_ABS
    );

    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data, v_old_len, v_new_len, TRUE, v_note);

    RAISE EXCEPTION USING
      MESSAGE = v_note,
      ERRCODE = 'P0001',
      HINT    = 'The client tried to shrink a protected array by more than '
              || SHRINK_THRESHOLD_PCT || '%. This is almost always a cache-staleness bug.';
  END IF;

  -- Passed the guard — snapshot and allow ------------------------------------
  INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
  VALUES (NEW.key, OLD.data, v_old_len, v_new_len, FALSE,
          CASE WHEN COALESCE(v_allow_bypass,'off')='on' THEN 'bulk_bypass'
               ELSE 'allowed' END);

  RETURN NEW;
END;
$$;

-- ============================================================================
-- Verification queries (run manually after apply):
--
--   -- 1. Confirm certifications is now protected
--   SELECT is_protected_store_key('certifications');  -- expect: true
--
--   -- 2. Check current students count
--   SELECT jsonb_array_length(data->'students') FROM store WHERE key='certifications';
--
--   -- 3. Test: attempt to wipe students (should fail)
--   BEGIN;
--     UPDATE store SET data = jsonb_set(data, '{students}', '[]') WHERE key='certifications';
--   ROLLBACK;
--   -- Expect: ERROR P0001 "SHRINK GUARD: key=certifications.students ..."
--
--   -- 4. Test: add one student (should pass)
--   BEGIN;
--     UPDATE store SET data = jsonb_set(data, '{students}',
--       data->'students' || '[{"id":"test"}]'::jsonb) WHERE key='certifications';
--   ROLLBACK;
--   -- Expect: 1 row updated, snapshot note='grew_or_equal'
-- ============================================================================
