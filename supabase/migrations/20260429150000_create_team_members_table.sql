-- Stage 11 Session A — create public.team_members table.
-- Dual-write from store.teamMembers blob during Session A/B;
-- blob retired in Session C (migration 20260429160000).

CREATE TABLE IF NOT EXISTS public.team_members (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  email      text        NOT NULL DEFAULT '',
  phone      text        NOT NULL DEFAULT '',
  loan_types text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_members_email_lower_idx
  ON public.team_members (lower(email));

-- Touch updated_at on every row update.
CREATE TRIGGER team_members_touch_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_team_members" ON public.team_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_team_members" ON public.team_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('staff','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('staff','admin')
    )
  );

CREATE POLICY "anon_read_team_members" ON public.team_members
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members;
