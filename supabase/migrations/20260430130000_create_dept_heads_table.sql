-- Stage 13 Session A — create public.dept_heads (collection).
-- Replaces store.deptHeads array. Blob is currently empty in prod, but
-- code does CRUD on it. Blob retired in 20260430140000_drop_legacy_config_blobs.

CREATE TABLE IF NOT EXISTS public.dept_heads (
  id          text        PRIMARY KEY,
  name        text        NOT NULL DEFAULT '',
  email       text        NOT NULL DEFAULT '',
  role        text        NOT NULL DEFAULT '',
  loan_types  text[]      NOT NULL DEFAULT '{}',
  lecturer_id text,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER dept_heads_touch_updated_at
  BEFORE UPDATE ON public.dept_heads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.dept_heads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_dept_heads" ON public.dept_heads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_dept_heads" ON public.dept_heads
  FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

CREATE POLICY "anon_read_dept_heads" ON public.dept_heads
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.dept_heads;

-- ─── Backfill from store.deptHeads array ───────────────────────────────────
WITH src AS (SELECT data FROM public.store WHERE key = 'deptHeads' LIMIT 1)
INSERT INTO public.dept_heads (id, name, email, role, loan_types, lecturer_id, sort_order)
SELECT
  COALESCE(elem->>'id', 'dh_' || floor(random() * 1000000000)::bigint::text),
  COALESCE(elem->>'name', ''),
  COALESCE(elem->>'email', ''),
  COALESCE(elem->>'role', ''),
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(elem->'loanTypes')),
    '{}'::text[]
  ),
  elem->>'lecturerId',
  (ord - 1)::int
FROM src,
LATERAL jsonb_array_elements(src.data) WITH ORDINALITY AS x(elem, ord)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
