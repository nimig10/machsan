-- ============================================================================
-- Migration 017: extend kits content guard to loanType + lessonId
-- ----------------------------------------------------------------------------
-- 016 detects wipes of items / kitType. The 2026-04-16 incident ALSO wiped
-- loanType from 2 kits. This extends the wipe signal to include:
--   - items     (had → now empty)
--   - kitType   (had → now null)
--   - loanType  (had → now null/empty)   ← NEW
--   - lessonId  (had → now null)          ← NEW (lesson-kit unlinking)
--
-- description and schedule deliberately excluded — legitimate to clear on
-- a single kit edit, and would produce noise.
--
-- Threshold stays at 2+ wipes in a single write. Bypass flag unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION kits_content_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allow_bypass  TEXT;
  v_wiped_count   INT := 0;
  v_wiped_names   TEXT := '';
  v_old_kit       JSONB;
  v_new_kit       JSONB;
  v_old_items     INT;
  v_new_items     INT;
  v_old_type      TEXT;
  v_new_type      TEXT;
  v_old_loan      TEXT;
  v_new_loan      TEXT;
  v_old_lesson    TEXT;
  v_new_lesson    TEXT;
  v_is_wiped      BOOLEAN;
  v_note          TEXT;
BEGIN
  IF NEW.key <> 'kits' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(OLD.data) <> 'array' OR jsonb_typeof(NEW.data) <> 'array' THEN
    RETURN NEW;
  END IF;

  v_allow_bypass := current_setting('app.allow_store_bulk_shrink', TRUE);
  IF COALESCE(v_allow_bypass, 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  FOR v_old_kit IN SELECT * FROM jsonb_array_elements(OLD.data)
  LOOP
    SELECT elem INTO v_new_kit
    FROM jsonb_array_elements(NEW.data) elem
    WHERE elem->>'id' = v_old_kit->>'id'
    LIMIT 1;

    IF v_new_kit IS NULL THEN
      CONTINUE;  -- removal handled by shrink_guard
    END IF;

    v_old_items  := jsonb_array_length(COALESCE(v_old_kit->'items', '[]'::jsonb));
    v_new_items  := jsonb_array_length(COALESCE(v_new_kit->'items', '[]'::jsonb));
    v_old_type   := v_old_kit->>'kitType';
    v_new_type   := v_new_kit->>'kitType';
    v_old_loan   := NULLIF(v_old_kit->>'loanType', '');
    v_new_loan   := NULLIF(v_new_kit->>'loanType', '');
    v_old_lesson := v_old_kit->>'lessonId';
    v_new_lesson := v_new_kit->>'lessonId';

    v_is_wiped :=
         (v_old_items  > 0           AND v_new_items  = 0)
      OR (v_old_type   IS NOT NULL   AND v_new_type   IS NULL)
      OR (v_old_loan   IS NOT NULL   AND v_new_loan   IS NULL)
      OR (v_old_lesson IS NOT NULL   AND v_new_lesson IS NULL);

    IF v_is_wiped THEN
      v_wiped_count := v_wiped_count + 1;
      v_wiped_names := v_wiped_names
                       || COALESCE(v_old_kit->>'name','<unnamed>')
                       || ', ';
    END IF;
  END LOOP;

  IF v_wiped_count >= 2 THEN
    v_note := format(
      'CONTENT GUARD: %s kits lost items/kitType/loanType/lessonId in one write (%s). '
      'Write refused. Likely stale-cache bug. '
      'If intentional, set app.allow_store_bulk_shrink=on.',
      v_wiped_count, rtrim(v_wiped_names, ', ')
    );

    INSERT INTO store_snapshots(key, data, prev_len, new_len, blocked, note)
    VALUES (NEW.key, OLD.data,
            jsonb_array_length(OLD.data),
            jsonb_array_length(NEW.data),
            TRUE,
            v_note);

    RAISE EXCEPTION USING
      MESSAGE = v_note,
      ERRCODE = 'P0001',
      HINT    = 'Multiple kits losing core fields simultaneously is almost '
             || 'always a client-side stale-state bug. Inspect the caller '
             || 'before setting the bypass flag.';
  END IF;

  RETURN NEW;
END;
$$;
