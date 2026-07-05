-- Productions board (לוח הפקות) — Archive ("ארכיון").
--
-- A production is "ended" once its LATEST shoot date (max(end_date)) has passed.
-- Ended productions leave the active board and move to an archive view. We persist
-- archive state in productions.archived_at (the single source of truth):
--   NULL      = active (on the board)
--   timestamp = when it FIRST became ended (preserved across later edits)
--
-- Recomputed by productions_refresh_archive_v1:
--   * post-save (client), scoped to one id  -> instant archive/restore
--   * daily Vercel cron (api/productions-archive.js), no id -> sweep all published
--
-- "Today" = Israeli calendar date (Asia/Jerusalem) to match the crons + overlap
-- guards. Postgres current_date uses the session TZ (UTC on Supabase) and would
-- flip on the wrong day for ~2-3h after Israeli midnight.
--
-- Anti-regression: archiving NEVER changes status (stays 'published'), so RLS
-- (public read published / director read own) and every other view keep working.
-- The 1-month student hide is a pure client view filter on top of archived_at.
-- The daily bulk UPDATE does NOT fire productions_director_overlap_trg — that
-- trigger is AFTER UPDATE OF status, director_student_id; archived_at is not in
-- its column list.

-- 1) Column — additive, nullable.
ALTER TABLE public.productions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS productions_archived_at_idx
  ON public.productions (archived_at)
  WHERE archived_at IS NOT NULL;

-- 2) RPC — recompute archive state for one production (non-null arg) or ALL
--    published productions (null arg, the cron sweep).
CREATE OR REPLACE FUNCTION public.productions_refresh_archive_v1(
  p_production_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_changed integer := 0;
BEGIN
  WITH scope AS (
    SELECT p.id, p.status, p.archived_at
      FROM public.productions p
     WHERE (p_production_id IS NOT NULL AND p.id = p_production_id)
        OR (p_production_id IS NULL     AND p.status = 'published')
  ),
  computed AS (
    SELECT s.id, s.status, s.archived_at AS old_at,
           (SELECT max(pd.end_date)
              FROM public.production_dates pd
             WHERE pd.production_id = s.id) AS last_end
      FROM scope s
  ),
  target AS (
    SELECT c.id,
           CASE
             -- Only PUBLISHED, ended productions archive. Drafts/cancelled stay
             -- NULL so a director's draft never leaves "ההפקות שלי".
             WHEN c.status = 'published'
                  AND c.last_end IS NOT NULL
                  AND c.last_end < v_today
               THEN COALESCE(c.old_at, now())   -- preserve FIRST-archived time
             ELSE NULL                          -- active / restored / not-yet-ended
           END AS new_at
      FROM computed c
  ),
  upd AS (
    UPDATE public.productions p
       SET archived_at = t.new_at
      FROM target t
     WHERE p.id = t.id
       AND p.archived_at IS DISTINCT FROM t.new_at   -- only real changes -> no realtime churn
    RETURNING p.id
  )
  SELECT count(*) INTO v_changed FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'scope', COALESCE(p_production_id, 'ALL_PUBLISHED'),
    'today_il', v_today,
    'changed', v_changed
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.productions_refresh_archive_v1(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.productions_refresh_archive_v1(text) TO authenticated, service_role;

-- 3) One-time backfill (published rows only, same rule as the daily sweep).
SELECT public.productions_refresh_archive_v1(NULL);
