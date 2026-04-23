-- 023_mark_overdue_email_sent.sql
-- Applied: 2026-04-17
--
-- Atomic single-row flip for the `overdue_email_sent` flag inside the
-- store.reservations JSON blob. Used by the client-side overdue email
-- useEffect (App.jsx) to avoid rewriting the entire reservations list,
-- which was triggering shrink_guard when the cached list lagged behind
-- concurrent submits by other users.
--
-- Pattern mirrors migration 021 (append_to_store_reservations): a
-- targeted JSONB update that the shrink_guard trigger ignores because
-- the array length stays the same.

CREATE OR REPLACE FUNCTION public.mark_overdue_email_sent(p_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.store
  SET data = (
    SELECT jsonb_agg(
      CASE
        WHEN (elem->>'id') = p_id
          THEN elem || jsonb_build_object('overdue_email_sent', true)
        ELSE elem
      END
    )
    FROM jsonb_array_elements(COALESCE(data, '[]'::jsonb)) AS elem
  ),
  updated_at = NOW()
  WHERE key = 'reservations';
$$;

REVOKE ALL ON FUNCTION public.mark_overdue_email_sent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_overdue_email_sent(text) TO service_role;
