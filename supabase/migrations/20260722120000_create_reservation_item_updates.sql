-- Feature: student equipment-list updates on an existing loan reservation
-- ("ההזמנות שלי" → add / increase-qty items). PR: reservation-updates.
--
-- This table is the UPDATE LEDGER — one row per submitted update. It is BOTH:
--   * the 2-updates-per-reservation counter (COUNT(*) of rows, capped at 2 —
--     a submitted update counts even if the warehouse later rejects it, so
--     rows are never deleted), and
--   * the audit history (who asked, when, what the warehouse decided, the
--     staff message sent to the student).
--
-- HARD GUARANTEE — must never affect existing loan logic:
--   * one-way FK to reservations_new with ON DELETE CASCADE.
--   * NOT referenced by create_reservation_v2 / update_reservation_status_v1 /
--     any availability computation. Pending gear lives in
--     reservation_pending_items (separate table, also invisible to the guards).
--   * No update row ⇒ nothing displayed, nothing blocked, everything flows
--     exactly as before the feature.
--
-- review_status lifecycle:
--   'auto_applied' — submitted while the reservation was still ממתין /
--                    אישור ראש מחלקה (non-blocking): the ops were applied
--                    directly to reservation_items and will be vetted by the
--                    normal warehouse approval. Counts toward the 2-cap.
--   'pending'      — submitted on a מאושר reservation: gear is parked in
--                    reservation_pending_items awaiting staff review.
--   'approved'     — staff approved every pending item at full quantity.
--   'partial'      — staff approved some items / reduced quantities.
--   'rejected'     — staff rejected the whole update.
--   'cancelled'    — the loan started (effective פעילה) while the update was
--                    waiting; it was closed without applying anything.
--
-- reviewed_by_staff_id has NO FK on purpose (same as
-- reservations_new.returned_by_staff_id) — the audit trail must survive the
-- staff user being deleted.

CREATE TABLE IF NOT EXISTS public.reservation_item_updates (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id       text        NOT NULL REFERENCES public.reservations_new(id) ON DELETE CASCADE,
  update_number        integer     NOT NULL CHECK (update_number BETWEEN 1 AND 2),
  base_status          text        NOT NULL,
  review_status        text        NOT NULL DEFAULT 'pending'
                                   CHECK (review_status IN ('pending','auto_applied','approved','partial','rejected','cancelled')),
  student_email        text        NOT NULL,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at          timestamptz,
  reviewed_by_staff_id uuid,
  reviewed_by_name     text,
  staff_message        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, update_number)
);

CREATE INDEX IF NOT EXISTS idx_riu_reservation ON public.reservation_item_updates (reservation_id);

-- Belt-and-braces: at most ONE update awaiting review per reservation.
-- (The submit RPC also serializes on the reservations_new row lock.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_riu_one_pending_per_reservation
  ON public.reservation_item_updates (reservation_id)
  WHERE review_status = 'pending';

CREATE TRIGGER reservation_item_updates_touch_updated_at
  BEFORE UPDATE ON public.reservation_item_updates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: read-all (the student's "ההזמנות שלי" panel and the warehouse modal
-- both read via the supabase client), writes ONLY via the service-role RPCs.
ALTER TABLE public.reservation_item_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_riu" ON public.reservation_item_updates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "read_riu" ON public.reservation_item_updates
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_item_updates;
