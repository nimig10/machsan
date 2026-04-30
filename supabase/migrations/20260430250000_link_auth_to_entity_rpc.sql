-- 20260430250000_link_auth_to_entity_rpc.sql
--
-- Atomic SECURITY DEFINER replacement for the client-side DELETE+UPSERT pattern
-- in PublicForm.upsertAuthEntityMap.
--
-- BUG IT FIXES:
--   The client used to (1) DELETE rows where entity matched but auth_user_id
--   differed, then (2) UPSERT on auth_user_id. The DELETE was silently denied
--   by RLS — auth_entity_map had INSERT/SELECT/UPDATE policies for users on
--   their own row, but NO DELETE policy. The stale row survived, so the
--   follow-up UPSERT INSERTed a competing row and hit the
--   uq_entity (entity_type, entity_id) UNIQUE constraint → 409 Conflict.
--
--   This blocked re-linking after a password reset (Supabase issues a fresh
--   auth.users.id when an email is re-registered).
--
-- This RPC runs SECURITY DEFINER so it can bypass RLS for the DELETE, but it
-- always uses auth.uid() as the auth_user_id — a user cannot link THEIR session
-- to someone else's entity.

CREATE OR REPLACE FUNCTION public.link_auth_to_entity(
  p_entity_type text,
  p_entity_id   text,
  p_email       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type NOT IN ('lecturer','student') THEN
    RAISE EXCEPTION 'invalid_entity_type: %', p_entity_type USING ERRCODE = '22023';
  END IF;
  IF p_entity_id IS NULL OR p_entity_id = '' THEN
    RAISE EXCEPTION 'missing_entity_id' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'missing_email' USING ERRCODE = '22023';
  END IF;

  -- Clean any row pointing this entity at a stale auth_user. Restricted to
  -- "same entity, different user" so a user can never wipe other people's rows.
  DELETE FROM public.auth_entity_map
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND auth_user_id <> v_auth_uid;

  -- Upsert the current user's mapping. ON CONFLICT (auth_user_id) handles the
  -- case where this user previously mapped to a different entity record.
  INSERT INTO public.auth_entity_map (auth_user_id, entity_type, entity_id, email)
  VALUES (v_auth_uid, p_entity_type, p_entity_id, lower(trim(p_email)))
  ON CONFLICT (auth_user_id) DO UPDATE
  SET entity_type = EXCLUDED.entity_type,
      entity_id   = EXCLUDED.entity_id,
      email       = EXCLUDED.email,
      updated_at  = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.link_auth_to_entity(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_auth_to_entity(text, text, text) TO authenticated;
