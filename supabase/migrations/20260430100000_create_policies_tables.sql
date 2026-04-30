-- Stage 13 Session A — create public.policies + public.policy_assets.
-- Replaces store.policies blob (5 Hebrew loan-type bodies + 1 commitment PDF).
-- Blob retired in 20260430140000_drop_legacy_config_blobs.

-- ─── policies (per-loan-type rows) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policies (
  loan_type   text        PRIMARY KEY,
  body        text        NOT NULL DEFAULT '',
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER policies_touch_updated_at
  BEFORE UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_policies" ON public.policies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_policies" ON public.policies
  FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

CREATE POLICY "anon_read_policies" ON public.policies
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.policies;

-- ─── policy_assets (commitment PDF singleton-ish) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_assets (
  slot           text        PRIMARY KEY,           -- e.g. 'commitment_pdf'
  filename       text,
  data_base64    text        NOT NULL,
  is_compressed  boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER policy_assets_touch_updated_at
  BEFORE UPDATE ON public.policy_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.policy_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_policy_assets" ON public.policy_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_policy_assets" ON public.policy_assets
  FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

CREATE POLICY "anon_read_policy_assets" ON public.policy_assets
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_assets;

-- ─── Backfill from store.policies blob ─────────────────────────────────────
WITH src AS (SELECT data FROM public.store WHERE key = 'policies' LIMIT 1)
INSERT INTO public.policies (loan_type, body, sort_order)
SELECT lt, COALESCE(src.data->>lt, ''), ord
FROM src,
LATERAL (VALUES
  ('פרטית', 0),
  ('הפקה', 1),
  ('סאונד', 2),
  ('קולנוע יומית', 3),
  ('לילה', 4)
) AS l(lt, ord)
ON CONFLICT (loan_type) DO NOTHING;

WITH src AS (SELECT data FROM public.store WHERE key = 'policies' LIMIT 1)
INSERT INTO public.policy_assets (slot, filename, data_base64, is_compressed)
SELECT
  'commitment_pdf',
  src.data->>'commitmentPdfName',
  src.data->>'commitmentPdf',
  COALESCE((src.data->>'commitmentPdfCompressed')::boolean, false)
FROM src
WHERE src.data->>'commitmentPdf' IS NOT NULL
  AND length(src.data->>'commitmentPdf') > 0
ON CONFLICT (slot) DO NOTHING;

NOTIFY pgrst, 'reload schema';
