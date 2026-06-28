-- Feature: internal staff coordination for equipment loan requests.
-- A fully DECOUPLED side-table that associates a team member with a loan
-- request (reservation) for the OUT (pickup) and/or RETURN handling.
--
-- HARD GUARANTEE — must never affect existing loan logic:
--   * one-way FK to reservations_new with ON DELETE CASCADE (deleting/altering
--     an assignment can never touch a reservation; deleting a reservation just
--     drops its assignment rows).
--   * NOT referenced by any RPC / trigger / reservation column.
--   * No assignment row  ⇒  nothing displayed, nothing blocked.
--
-- One worker per (reservation, kind) slot — enforced by UNIQUE(reservation_id, kind).

CREATE TABLE IF NOT EXISTS public.reservation_staff_assignments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id text        NOT NULL REFERENCES public.reservations_new(id) ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN ('out','return')),
  staff_id       uuid        NOT NULL,
  staff_name     text,
  assigned_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_rsa_staff ON public.reservation_staff_assignments (staff_id);

-- Touch updated_at on every row update.
CREATE TRIGGER reservation_staff_assignments_touch_updated_at
  BEFORE UPDATE ON public.reservation_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: read-all (warehouse + schedule views read via the supabase client),
-- writes only via the service-role API endpoint (/api/staff-schedule).
ALTER TABLE public.reservation_staff_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_rsa" ON public.reservation_staff_assignments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "read_rsa" ON public.reservation_staff_assignments
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_staff_assignments;
