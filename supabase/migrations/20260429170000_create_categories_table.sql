-- Stage 12 Session A — create public.categories table.
-- Merges store.categories (string array) + store.categoryTypes (name→type map)
-- into a single normalized table. Blob retired in migration 20260429190000.

CREATE TABLE IF NOT EXISTS public.categories (
  name           text        PRIMARY KEY,
  equipment_type text        NOT NULL DEFAULT '',
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER categories_touch_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_categories" ON public.categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_categories" ON public.categories
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('staff','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('staff','admin')
    )
  );

CREATE POLICY "anon_read_categories" ON public.categories
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
