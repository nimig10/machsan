-- is_known_lecturer_email RPC
--
-- The /api/lecturer-kit endpoint checked caller eligibility by hitting
-- /rest/v1/lecturers?email=ilike.<encoded-email> via PostgREST's URL
-- query string. Emails containing "+" (e.g. nimig10+r1@gmail.com) hit
-- a URL-encoding edge case where some intermediaries decode "%2B" back
-- to "+" and then form-encoded parsing turns "+" into space — the ilike
-- value becomes "nimig10 r1@gmail.com", matches nothing, and the
-- endpoint returns 403 "Forbidden: not a lecturer" even though the
-- email IS in public.lecturers.
--
-- Fix: dedicated SECURITY DEFINER RPC. Email goes through the JSON
-- body (no URL encoding involved). Returns boolean. Single-purpose,
-- read-only — no side effects.

CREATE OR REPLACE FUNCTION public.is_known_lecturer_email(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lecturers
    WHERE LOWER(email) = LOWER(TRIM(COALESCE(p_email, '')))
      AND COALESCE(p_email, '') <> ''
  );
$function$;

COMMENT ON FUNCTION public.is_known_lecturer_email(text) IS
'Returns true iff the given email matches a row in public.lecturers (case-insensitive, trimmed). Used by /api/lecturer-kit to gate access. Avoids the URL-encoding ambiguity that affects emails with a "+" sign when querying via the REST URL query string.';

-- Grant execute to authenticated and service_role since the API server
-- calls this with the service-role key.
GRANT EXECUTE ON FUNCTION public.is_known_lecturer_email(text) TO authenticated, service_role, anon;
