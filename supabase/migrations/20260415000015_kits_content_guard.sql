-- ============================================================================
-- Migration 016: content-level guard for kits — prevents silent field wiping
-- ----------------------------------------------------------------------------
-- WHY:
--   The 2026-04-16 13:12 incident was NOT caught by the shrink guard because
--   the array length barely changed (7→5), but crucially, the kits that
--   REMAINED in the array had their `items`, `kitType`, and `loanType` fields
--   silently wiped to empty/null. The shrink guard only measures array length;
--   it is blind to field-level data loss within unchanged elements.
--
--   Root cause of that incident: a client save-path that built kit objects
--   with only {id, name}, producing a whole-array overwrite that preserved the
--   kit identity but lost all content. No activity_log, no block, no warning.
--
-- WHAT THIS DOES:
--   Adds a BEFORE UPDATE trigger on store (key='kits' only) that compares
--   OLD vs NEW kit-by-kit (matching by id):
--     - If a kit had items, now has none → flag
--     - If a kit had kitType, now null → flag
--   If 2 or more kits flagged in one write → RAISE P0001.
--   1 flagged kit is allowed (legitimate: user clearing a kit's items).
--
-- BYPASS:
--   Honors the same `app.allow_store_bulk_shrink=on` session flag as the
--   shrink guard — so intentional bulk edits can still proceed with the
--   explicit opt-in.
--
-- SNAPSHOTS:
--   On block, writes a row to store_snapshots with note='content_wipe_blocked'
--   so forensics can see exactly what the client tried to push.
-- ============================================================================

CREATE OR REPLACE FUNCTION kits_content_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allow_bypass TEXT;
  v_wiped_count  INT := 0;
  v_wiped_names  TEXT := '';
  v_old_kit      JSONB;
  v_new_kit      JSONB;
  v_old_items    INT;
  v_new_items    INT;
  v_old_type     TEXT;
  v_new_type     TEXT;
  v_note         TEXT;
BEGIN
  -- Only guard kits key (trigger-level filter already narrows, but be safe)
  IF NEW.key <> 'kits' THEN
    RETURN NEW;
  END IF;

  -- Both sides must be arrays (if not, let shrink_guard handle it)
  IF jsonb_typeof(OLD.data) <> 'array' OR jsonb_typeof(NEW.data) <> 'array' THEN
    RETURN NEW;
  END IF;

  -- Allow explicit bulk bypass
  v_allow_bypass := current_setting('app.allow_store_bulk_shrink', TRUE);
  IF COALESCE(v_allow_bypass, 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Scan each kit in OLD; for ones still present in NEW (by id), compare content
  FOR v_old_kit IN SELECT * FROM jsonb_array_elements(OLD.data)
  LOOP
    SELECT elem INTO v_new_kit
    FROM jsonb_array_elements(NEW.data) elem
    WHERE elem->>'id' = v_old_kit->>'id'
    LIMIT 1;

    -- Kit removed (shrink_guard handles count changes) — not our concern here
    IF v_new_kit IS NULL THEN
      CONTINUE;
    END IF;

    v_old_items := jsonb_array_length(COALESCE(v_old_kit->'items', '[]'::jsonb));
    v_new_items := jsonb_array_length(COALESCE(v_new_kit->'items', '[]'::jsonb));
    v_old_type  := v_old_kit->>'kitType';
    v_new_type  := v_new_kit->>'kitType';

    -- Wipe conditions: had items → lost them, OR had kitType → now null
    IF (v_old_items > 0 AND v_new_items = 0)
       OR (v_old_type IS NOT NULL AND v_new_type IS NULL)
    THEN
      v_wiped_count := v_wiped_count + 1;
      v_wiped_names := v_wiped_names
                       || COALESCE(v_old_kit->>'name','<unnamed>')
                       || ', ';
    END IF;
  END LOOP;

  -- 2+ wipes in a single write → block. 1 wipe is legitimate (manual clear).
  IF v_wiped_count >= 2 THEN
    v_note := format(
      'CONTENT GUARD: %s kits had items/kitType wiped in one write (%s). '
      'Write refused. Likely stale-cache bug. '
      'If intentional, set app.allow_store_bulk_shrink=on.',
      v_wiped_count, rtrim(v_wiped_names, ', ')
    );

    -- Snapshot the attempted write for forensics (OLD.data = last good state)
    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data,
            jsonb_array_length(OLD.data),
            jsonb_array_length(NEW.data),
            TRUE,
            v_note);

    RAISE EXCEPTION USING
      MESSAGE = v_note,
      ERRCODE = 'P0001',
      HINT    = 'Multiple kits losing items or kitType simultaneously is '
             || 'almost always a client-side stale-state bug. Inspect the '
             || 'caller before setting the bypass flag.';
  END IF;

  RETURN NEW;
END;
$$;

-- Register the trigger (BEFORE UPDATE, narrow to kits key via WHEN)
DROP TRIGGER IF EXISTS trg_kits_content_guard ON store;
CREATE TRIGGER trg_kits_content_guard
BEFORE UPDATE ON store
FOR EACH ROW
WHEN (NEW.key = 'kits')
EXECUTE FUNCTION kits_content_guard();

-- ============================================================================
-- Verification queries (run manually after apply):
--
--   -- 1. Confirm trigger exists
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgname = 'trg_kits_content_guard';
--   -- expect: one row, tgenabled='O' (enabled)
--
--   -- 2. Test: attempt to wipe items from 2 kits (should fail)
--   BEGIN;
--     UPDATE store
--     SET data = (
--       SELECT jsonb_agg(
--         CASE
--           WHEN elem->>'id' IN (
--             (SELECT k->>'id' FROM jsonb_array_elements(data) k
--              WHERE jsonb_array_length(COALESCE(k->'items','[]'::jsonb))>0
--              LIMIT 2)
--           )
--           THEN elem || '{"items":[]}'::jsonb
--           ELSE elem
--         END
--       )
--       FROM jsonb_array_elements(data) elem
--     )
--     WHERE key='kits';
--   ROLLBACK;
--   -- expect: ERROR P0001 "CONTENT GUARD: 2 kits had items/kitType wiped..."
--
--   -- 3. Test: wipe items from 1 kit (should succeed — legitimate edit)
--   BEGIN;
--     UPDATE store SET data = jsonb_set(data,
--       ARRAY[(jsonb_path_query_first(data,'$[*] ? (@.items.size() > 0)') IS NOT NULL)::text],
--       '[]'::jsonb) WHERE key='kits';
--   ROLLBACK;
--   -- expect: 1 row updated, no error
-- ============================================================================
