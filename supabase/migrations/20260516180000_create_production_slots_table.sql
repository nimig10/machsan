-- Productions board — slot-based crew composition.
-- The director defines empty slots (role + quantity). Students self-enroll
-- into those slots via production_crew (status='invited' → director approves).
-- Direct-invite flow is gone: all crew rows from now on are invited_by='self'.

CREATE TABLE IF NOT EXISTS public.production_slots (
  id              text PRIMARY KEY,
  production_id   text NOT NULL REFERENCES public.productions(id) ON DELETE CASCADE,
  role            text NOT NULL
                    CHECK (role IN ('photographer','sound','custom')),
  role_label      text,
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'custom' OR (role_label IS NOT NULL AND length(btrim(role_label)) > 0))
);

CREATE INDEX IF NOT EXISTS production_slots_production_idx
  ON public.production_slots (production_id);

DROP TRIGGER IF EXISTS production_slots_touch_updated_at ON public.production_slots;
CREATE TRIGGER production_slots_touch_updated_at
  BEFORE UPDATE ON public.production_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.production_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_slots_service_role_all ON public.production_slots;
CREATE POLICY production_slots_service_role_all
  ON public.production_slots
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS production_slots_staff_all ON public.production_slots;
CREATE POLICY production_slots_staff_all
  ON public.production_slots
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Public read: anyone authenticated/anon can read slots of any production
-- (needed for the "open slots" dropdown on the student side). Status filtering
-- (only published productions) is enforced by callers / RLS on productions.
DROP POLICY IF EXISTS production_slots_read ON public.production_slots;
CREATE POLICY production_slots_read
  ON public.production_slots
  FOR SELECT TO anon, authenticated
  USING (true);

-- Director full CRUD on slots of own production.
DROP POLICY IF EXISTS production_slots_director_manage ON public.production_slots;
CREATE POLICY production_slots_director_manage
  ON public.production_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_slots.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_slots.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ));

ALTER PUBLICATION supabase_realtime ADD TABLE public.production_slots;

-- Backfill: collapse any existing production_crew rows into slots.
-- For each (production_id, role, role_label) group, create one slot row with
-- quantity = MAX(approved_count, 1). This is a one-shot migration; new
-- productions will create slots through the editor.
INSERT INTO public.production_slots (id, production_id, role, role_label, quantity, sort_order)
SELECT
  'ps_backfill_' || production_id || '_' || row_number() OVER (PARTITION BY production_id ORDER BY role) AS id,
  production_id,
  role,
  CASE WHEN role = 'custom' THEN role_label ELSE NULL END AS role_label,
  GREATEST(COUNT(*) FILTER (WHERE status IN ('invited','approved')), 1) AS quantity,
  row_number() OVER (PARTITION BY production_id ORDER BY role) - 1 AS sort_order
FROM public.production_crew
GROUP BY production_id, role, role_label
ON CONFLICT (id) DO NOTHING;
