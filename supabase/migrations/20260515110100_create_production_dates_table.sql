-- Productions board (לוח הפקות) — Session 2/N: production_dates child table.
-- One row per shoot session. The director adds 1..N dates; equipment loans
-- created from this production reference exactly one production_date row.

CREATE TABLE IF NOT EXISTS public.production_dates (
  id            text PRIMARY KEY,
  production_id text NOT NULL REFERENCES public.productions(id) ON DELETE CASCADE,
  start_date    date NOT NULL,
  start_time    time NOT NULL,
  end_date      date NOT NULL,
  end_time      time NOT NULL,
  note          text,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((end_date + end_time) > (start_date + start_time))
);

CREATE INDEX IF NOT EXISTS production_dates_production_idx
  ON public.production_dates (production_id);

CREATE INDEX IF NOT EXISTS production_dates_start_idx
  ON public.production_dates (start_date, start_time);

DROP TRIGGER IF EXISTS production_dates_touch_updated_at ON public.production_dates;
CREATE TRIGGER production_dates_touch_updated_at
  BEFORE UPDATE ON public.production_dates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.production_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_dates_service_role_all ON public.production_dates;
CREATE POLICY production_dates_service_role_all
  ON public.production_dates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS production_dates_staff_all ON public.production_dates;
CREATE POLICY production_dates_staff_all
  ON public.production_dates
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Public can read date rows only when the parent production is published.
DROP POLICY IF EXISTS production_dates_public_read_published ON public.production_dates;
CREATE POLICY production_dates_public_read_published
  ON public.production_dates
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_dates.production_id
       AND p.status = 'published'
  ));

-- Director full CRUD on dates of their own productions (any status).
DROP POLICY IF EXISTS production_dates_director_manage ON public.production_dates;
CREATE POLICY production_dates_director_manage
  ON public.production_dates
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_dates.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.productions p
     WHERE p.id = production_dates.production_id
       AND lower(p.director_email) = lower(auth.jwt() ->> 'email')
  ));

ALTER PUBLICATION supabase_realtime ADD TABLE public.production_dates;
