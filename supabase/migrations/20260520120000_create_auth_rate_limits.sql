-- DB-backed rate limit events for auth flows.
-- Service-role API routes write and read this table; clients never access it.

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  email text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'auth_rate_limits'
      AND policyname = 'service_role_all_auth_rate_limits'
  ) THEN
    CREATE POLICY service_role_all_auth_rate_limits
      ON public.auth_rate_limits
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS auth_rate_limits_action_email_created_idx
  ON public.auth_rate_limits (action, email, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_rate_limits_action_ip_created_idx
  ON public.auth_rate_limits (action, ip_address, created_at DESC);

