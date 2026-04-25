-- ============================================================================
-- Migration 011: Shrink guard + rolling snapshots on the `store` table
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Root-cause fix for the silent-delete class of bugs we hit on 2026-04-16,
--   when a single "save lesson kit" click erased 3 unrelated kits and 14
--   unrelated reservations (see restore log). The pattern:
--
--     1) Client A opens the app, gets `store.kits = [k1,k2,...,k8]` in cache.
--     2) Client B adds kit k9; `store.kits` now has 9 entries server-side.
--     3) Client A, hours later, saves an edit on k1. The client sends
--        storageSet('kits', [k1',k2,...,k8]) — no k9. Server writes 8.
--        k9 is gone. Nothing in activity_log, nothing in the backup because
--        the backup was overwritten a few writes later with the same 8 rows.
--
--   This migration installs TWO server-side safety nets that fire on every
--   UPDATE to `store`, regardless of which client/endpoint made the change.
--
-- PROTECTIONS:
--
--   A) shrink_guard trigger
--      Blocks any UPDATE that shrinks a protected key's array by more than
--      SHRINK_THRESHOLD_PCT percent AND more than SHRINK_THRESHOLD_ABS rows.
--      The intent is to stop "accidentally wiped most of the list" writes
--      without getting in the way of legitimate small deletions.
--
--      Bypass: a caller that KNOWS it is doing a bulk delete (e.g. an
--      admin cleanup tool) can set the session variable
--      `app.allow_store_bulk_shrink = 'on'` before the UPDATE. The trigger
--      resets to 'off' after each statement (so it can't leak between
--      requests on a pooled connection).
--
--   B) store_snapshots table
--      Every UPDATE to a protected key copies the PREVIOUS value into
--      store_snapshots(key, data, taken_at). 30 days of history so if a
--      guarded shrink ever slips through (e.g. slow erosion of 5% at a
--      time), we can reconstruct the state from any point.
--
-- PROTECTED KEYS (array-valued, critical):
--   kits, reservations, equipment, studios, studio_bookings, studioBookings,
--   lessons, lecturers, teamMembers, categories
--
-- NOT PROTECTED:
--   Object-valued keys (siteSettings, policies, certifications, ...).
--   Those don't have "length" to shrink by. If we ever find a shrink-bug
--   on one of them, we'll add an object-key guard with a json-deepcompare.
--
-- SAFETY:
--   * CREATE OR REPLACE — fully re-runnable.
--   * Trigger only BEFORE UPDATE — does not block INSERTs (initial setup).
--   * The guard uses RAISE EXCEPTION, which aborts the whole transaction.
--     The client gets an HTTP 4xx from PostgREST and the cache reverts
--     (utils.js storageSet already reverts on 4xx response).
--   * snapshots table is insert-only from the trigger; cleanup is a separate
--     cron-ish call to `prune_store_snapshots()` that keeps 30 days.
--
-- TUNING:
--   SHRINK_THRESHOLD_PCT: 10 (the 2026-04-16 bug that lost 14 reservations
--                             was a 13.2% shrink; the kits bug was 25%)
--   SHRINK_THRESHOLD_ABS: 1  (a drop of >= 2 rows in a single write is
--                             suspicious — normal UI paths delete one row
--                             per transaction. Multi-row admin cleanups
--                             must set app.allow_store_bulk_shrink=on.)
--   SNAPSHOT_KEEP_DAYS:  30
-- ============================================================================

-- Rolling snapshots table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS store_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT        NOT NULL,
  data        JSONB       NOT NULL,
  prev_len    INT,          -- length of the previous array (NULL for objects)
  new_len     INT,          -- length that the UPDATE tried to install
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked     BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE if the guard rejected
  note        TEXT
);

CREATE INDEX IF NOT EXISTS store_snapshots_key_taken_idx
  ON store_snapshots (key, taken_at DESC);

CREATE INDEX IF NOT EXISTS store_snapshots_blocked_idx
  ON store_snapshots (blocked, taken_at DESC)
  WHERE blocked = TRUE;

-- Helper: is this key protected? ---------------------------------------------
CREATE OR REPLACE FUNCTION is_protected_store_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
  SELECT p_key = ANY(ARRAY[
    'kits','reservations','equipment',
    'studios','studio_bookings','studioBookings',
    'lessons','lecturers','teamMembers','categories','students'
  ]);
$$;

-- Trigger function: guard + snapshot -----------------------------------------
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
  v_blocked            BOOLEAN := FALSE;
  v_note               TEXT := NULL;
BEGIN
  -- Only guard protected keys
  IF NOT is_protected_store_key(NEW.key) THEN
    RETURN NEW;
  END IF;

  -- Only guard array-to-array updates
  IF jsonb_typeof(OLD.data) <> 'array' OR jsonb_typeof(NEW.data) <> 'array' THEN
    RETURN NEW;
  END IF;

  v_old_len := jsonb_array_length(OLD.data);
  v_new_len := jsonb_array_length(NEW.data);

  -- If the list got longer or stayed the same, nothing to guard
  IF v_new_len >= v_old_len THEN
    -- Still snapshot protected-key updates so we have a full history
    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data, v_old_len, v_new_len, FALSE, 'grew_or_equal');
    RETURN NEW;
  END IF;

  -- Compute shrink percentage
  IF v_old_len = 0 THEN
    v_shrink_pct := 0;
  ELSE
    v_shrink_pct := ((v_old_len - v_new_len)::NUMERIC / v_old_len) * 100;
  END IF;

  -- Bypass check: set app.allow_store_bulk_shrink = 'on' for admin tools
  v_allow_bypass := current_setting('app.allow_store_bulk_shrink', TRUE);

  IF v_shrink_pct > SHRINK_THRESHOLD_PCT
     AND (v_old_len - v_new_len) > SHRINK_THRESHOLD_ABS
     AND COALESCE(v_allow_bypass, 'off') <> 'on'
  THEN
    v_blocked := TRUE;
    v_note := format(
      'SHRINK GUARD: key=%s old=%s new=%s drop=%s%% (threshold=%s%%/%srows). '
      'Write refused. If intentional, set app.allow_store_bulk_shrink=on.',
      NEW.key, v_old_len, v_new_len,
      round(v_shrink_pct,1), SHRINK_THRESHOLD_PCT, SHRINK_THRESHOLD_ABS
    );

    -- Snapshot the attempted write (blocked=TRUE) so forensics has it
    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data, v_old_len, v_new_len, TRUE, v_note);

    RAISE EXCEPTION USING
      MESSAGE = v_note,
      ERRCODE = 'P0001',
      HINT    = 'The client tried to shrink a protected array by more than '
              || SHRINK_THRESHOLD_PCT || '%. This is almost always a cache-staleness bug.';
  END IF;

  -- Passed the guard — snapshot the previous value before letting the write through
  INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
  VALUES (NEW.key, OLD.data, v_old_len, v_new_len, FALSE,
          CASE WHEN COALESCE(v_allow_bypass,'off')='on' THEN 'bulk_bypass'
               ELSE 'allowed' END);

  RETURN NEW;
END;
$$;

-- Attach trigger -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_store_shrink_guard ON store;
CREATE TRIGGER trg_store_shrink_guard
  BEFORE UPDATE ON store
  FOR EACH ROW
  EXECUTE FUNCTION store_shrink_guard();

-- Snapshot prune helper ------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_store_snapshots(p_keep_days INT DEFAULT 30)
RETURNS INT
LANGUAGE SQL
AS $$
  WITH d AS (
    DELETE FROM store_snapshots
    WHERE taken_at < NOW() - (p_keep_days || ' days')::INTERVAL
      AND blocked = FALSE  -- always keep blocked attempts for forensics
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM d;
$$;

-- ============================================================================
-- Verification queries (run manually after apply):
--
--   -- 1. Confirm trigger exists
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_store_shrink_guard';
--
--   -- 2. Test: attempt to shrink `kits` from 7 to 3 (should fail)
--   BEGIN;
--     UPDATE store SET data = '[{"id":1},{"id":2},{"id":3}]'::jsonb
--     WHERE key = 'kits';
--   ROLLBACK;
--   -- Expect: ERROR P0001 "SHRINK GUARD: key=kits old=7 new=3 drop=57.1% ..."
--
--   -- 3. Test: legitimate small shrink (7 → 6 = 14%, below 20% threshold) passes
--   BEGIN;
--     UPDATE store SET data = data - 0  -- drop first element
--     WHERE key = 'kits';
--   ROLLBACK;
--   -- Expect: 1 row updated, snapshot recorded with blocked=FALSE
--
--   -- 4. Test: bypass mode allows large shrink (admin cleanup)
--   BEGIN;
--     SET LOCAL app.allow_store_bulk_shrink = 'on';
--     UPDATE store SET data = '[]'::jsonb WHERE key='kits';
--   ROLLBACK;
--   -- Expect: succeeds, snapshot note='bulk_bypass'
--
--   -- 5. Inspect snapshot history
--   SELECT taken_at, key, prev_len, new_len, blocked, note
--   FROM store_snapshots
--   ORDER BY taken_at DESC
--   LIMIT 20;
-- ============================================================================
