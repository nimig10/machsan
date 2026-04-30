-- Stage 13 Session A — create public.college_manager (singleton row).
-- Replaces store.collegeManager blob ({name, email}).
-- Blob retired in 20260430140000_drop_legacy_config_blobs.

CREATE TABLE IF NOT EXISTS public.college_manager (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name        text        NOT NULL DEFAULT '',
  email       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER college_manager_touch_updated_at
  BEFORE UPDATE ON public.college_manager
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.college_manager ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_college_manager" ON public.college_manager
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_college_manager" ON public.college_manager
  FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

CREATE POLICY "anon_read_college_manager" ON public.college_manager
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.college_manager;

-- ─── Backfill from store.collegeManager ────────────────────────────────────
WITH src AS (SELECT data FROM public.store WHERE key = 'collegeManager' LIMIT 1)
INSERT INTO public.college_manager (id, name, email)
SELECT 1,
       COALESCE(src.data->>'name', ''),
       COALESCE(src.data->>'email', '')
FROM src
ON CONFLICT (id) DO UPDATE
  SET name  = EXCLUDED.name,
      email = EXCLUDED.email;

-- Guarantee singleton row exists even if blob was missing.
INSERT INTO public.college_manager (id, name, email)
VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
