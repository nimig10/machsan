-- ============================================================================
-- 20260101000000_bootstrap_base_tables.sql
-- ----------------------------------------------------------------------------
-- Creates the base tables that were set up manually before the migration
-- system existed. All statements use IF NOT EXISTS — fully idempotent.
-- Running this on the production DB is a safe no-op.
--
-- Tables created here:
--   store, users, activity_logs, staff_members, auth_entity_map,
--   staff_schedule_preferences, staff_schedule_assignments
-- ============================================================================

-- ─── store ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store (
  key        TEXT        PRIMARY KEY,
  data       JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store' AND policyname='service_role_all') THEN
    CREATE POLICY service_role_all ON public.store FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store' AND policyname='authenticated_select_all') THEN
    CREATE POLICY authenticated_select_all ON public.store FOR SELECT USING (true);
  END IF;
END $$;

-- ─── is_admin() helper (needed by users RLS policies below) ──────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true
  );
$$;

-- ─── users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  phone             TEXT,
  is_student        BOOLEAN     NOT NULL DEFAULT false,
  is_lecturer       BOOLEAN     NOT NULL DEFAULT false,
  is_warehouse      BOOLEAN     NOT NULL DEFAULT false,
  is_admin          BOOLEAN     NOT NULL DEFAULT false,
  permissions       JSONB,
  push_subscription JSONB,
  is_push_enabled   BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_read_own') THEN
    CREATE POLICY users_read_own ON public.users FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_update_own') THEN
    CREATE POLICY users_update_own ON public.users FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (
        is_student   = (SELECT u.is_student   FROM public.users u WHERE u.id = auth.uid()) AND
        is_lecturer  = (SELECT u.is_lecturer  FROM public.users u WHERE u.id = auth.uid()) AND
        is_warehouse = (SELECT u.is_warehouse FROM public.users u WHERE u.id = auth.uid()) AND
        is_admin     = (SELECT u.is_admin     FROM public.users u WHERE u.id = auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_admin_read_all') THEN
    CREATE POLICY users_admin_read_all ON public.users FOR SELECT USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_admin_write') THEN
    CREATE POLICY users_admin_write ON public.users FOR ALL
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ─── activity_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT        NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB       DEFAULT '{}'
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activity_logs' AND policyname='service_role_all') THEN
    CREATE POLICY service_role_all ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── staff_members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_members (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name     TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'staff',
  password_hash TEXT        NOT NULL,
  permissions   JSONB       NOT NULL DEFAULT '{"views":[],"notifyLoanTypes":[],"warehouseSections":[],"administrationSections":[]}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_members' AND policyname='service_role_all') THEN
    CREATE POLICY service_role_all ON public.staff_members FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── auth_entity_map ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_entity_map (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_entity_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='auth_entity_map' AND policyname='Users can read own mapping') THEN
    CREATE POLICY "Users can read own mapping"   ON public.auth_entity_map FOR SELECT USING (auth.uid() = auth_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='auth_entity_map' AND policyname='Users can insert own mapping') THEN
    CREATE POLICY "Users can insert own mapping" ON public.auth_entity_map FOR INSERT WITH CHECK (auth.uid() = auth_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='auth_entity_map' AND policyname='Users can update own mapping') THEN
    CREATE POLICY "Users can update own mapping" ON public.auth_entity_map FOR UPDATE USING (auth.uid() = auth_user_id);
  END IF;
END $$;

-- ─── staff_schedule_preferences ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_schedule_preferences (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id    UUID        NOT NULL,
  date        DATE        NOT NULL,
  shift_type  TEXT        NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  note        TEXT        DEFAULT '',
  note_public BOOLEAN     DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.staff_schedule_preferences ENABLE ROW LEVEL SECURITY;

-- ─── staff_schedule_assignments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_schedule_assignments (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id    UUID        NOT NULL,
  date        DATE        NOT NULL,
  shift_type  TEXT        NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  note        TEXT        DEFAULT '',
  note_public BOOLEAN     DEFAULT true,
  locked      BOOLEAN     DEFAULT false,
  assigned_by UUID,
  source      TEXT        DEFAULT 'manager',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.staff_schedule_assignments ENABLE ROW LEVEL SECURITY;
