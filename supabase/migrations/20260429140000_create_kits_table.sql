-- Stage 11 Session A — create public.kits table.
-- Dual-write from store.kits blob during Session A/B;
-- blob retired in Session C (migration 20260429160000).

CREATE TABLE IF NOT EXISTS public.kits (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  items       jsonb       NOT NULL DEFAULT '[]',
  loan_types  text[]      NOT NULL DEFAULT '{}',
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Touch updated_at on every row update (reuse trigger fn from Stage 6).
CREATE TRIGGER kits_touch_updated_at
  BEFORE UPDATE ON public.kits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_kits" ON public.kits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_kits" ON public.kits
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

CREATE POLICY "anon_read_kits" ON public.kits
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.kits;
