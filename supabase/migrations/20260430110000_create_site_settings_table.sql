-- Stage 13 Session A — create public.site_settings (key/value JSONB rows).
-- Replaces store.siteSettings blob (~9 fields incl. logo Base64) plus
-- absorbs store.managerToken into a single 'managerToken' row here.
-- Blob retired in 20260430140000_drop_legacy_config_blobs.

CREATE TABLE IF NOT EXISTS public.site_settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER site_settings_touch_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_site_settings" ON public.site_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_site_settings" ON public.site_settings
  FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

CREATE POLICY "anon_read_site_settings" ON public.site_settings
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;

-- ─── Backfill from store.siteSettings + store.managerToken ─────────────────
WITH src AS (SELECT data FROM public.store WHERE key = 'siteSettings' LIMIT 1)
INSERT INTO public.site_settings (key, value)
SELECT s.key, s.value
FROM src, LATERAL jsonb_each(src.data) AS s(key, value)
ON CONFLICT (key) DO NOTHING;

-- managerToken row (was a separate top-level store key)
WITH mgr AS (SELECT data FROM public.store WHERE key = 'managerToken' LIMIT 1)
INSERT INTO public.site_settings (key, value)
SELECT 'managerToken', mgr.data
FROM mgr
WHERE mgr.data IS NOT NULL
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
