-- Feature: student equipment-list updates — the PENDING ITEMS themselves.
-- One row per requested add / quantity-increase / replacement submitted on an
-- already-approved (מאושר) reservation, awaiting warehouse review.
--
-- ⚠️ THE WHOLE POINT OF THIS TABLE IS WHERE IT ISN'T:
-- pending gear lives HERE and NOT in reservation_items. Every availability
-- guard in the system (create_reservation_v2, update_reservation_status_v1,
-- computeEquipmentAvailability in src/utils.js) derives demand from
-- reservation_items JOIN reservations_new ON blocking statuses — so rows in
-- this table are structurally invisible to inventory math:
--   * pending items DO NOT hold stock before staff approval, and
--   * the already-approved items keep holding stock untouched.
-- Do NOT "optimize" this into a status column on reservation_items — that
-- would leak pending demand into every peak-concurrent CTE.
--
-- action semantics (ADD and INCREASE only — a "replace" concept was designed
-- and then removed before launch as needlessly confusing; the student simply
-- removes an item and adds another):
--   'add'      — new equipment not on the reservation. quantity = requested qty.
--   'increase' — more of an existing item. target_item_id = the
--                reservation_items row; quantity = the DELTA to add.
--
-- Rows are KEPT after review (review_state flips to approved/rejected,
-- approved_quantity records a partial approval) — they are the per-item audit
-- trail under the reservation_item_updates ledger.

CREATE TABLE IF NOT EXISTS public.reservation_pending_items (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  update_id             bigint      NOT NULL REFERENCES public.reservation_item_updates(id) ON DELETE CASCADE,
  reservation_id        text        NOT NULL REFERENCES public.reservations_new(id) ON DELETE CASCADE,
  action                text        NOT NULL CHECK (action IN ('add','increase')),
  equipment_id          text        REFERENCES public.equipment(id) ON DELETE SET NULL,
  name                  text,
  quantity              integer     NOT NULL CHECK (quantity > 0),
  target_item_id        bigint,
  review_state          text        NOT NULL DEFAULT 'pending'
                                    CHECK (review_state IN ('pending','approved','rejected')),
  approved_quantity     integer     CHECK (approved_quantity IS NULL OR approved_quantity > 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rpi_update      ON public.reservation_pending_items (update_id);
CREATE INDEX IF NOT EXISTS idx_rpi_reservation ON public.reservation_pending_items (reservation_id);

-- RLS: read-all (student panel + warehouse modal read via the supabase
-- client), writes ONLY via the service-role RPCs.
ALTER TABLE public.reservation_pending_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_rpi" ON public.reservation_pending_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "read_rpi" ON public.reservation_pending_items
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_pending_items;
