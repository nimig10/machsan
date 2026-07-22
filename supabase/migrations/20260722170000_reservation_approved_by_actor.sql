-- 20260722170000_reservation_approved_by_actor.sql
--
-- WHY
-- ---
-- The reservation shows WHEN it was approved but never WHO on the staff
-- approved it. activity_logs writes action='reservation_approve' with a name,
-- but that identity comes from the client (sessionStorage) and is spoofable
-- (lesson #37) — not trustworthy enough to display on the request itself.
--
-- These two columns record the staff user who ACTUALLY moved the request to
-- 'מאושר', derived server-side from the JWT in api/update-reservation-status.js
-- (the same endpoint and mechanism as returned_by_* / PR #80). That placement
-- covers every approve path, including the dashboard button which carries no
-- staff identity on the client at all.
--
-- NO FK on approved_by_staff_id: the name must survive deletion of the user
-- row (lesson #31 permits removing orphaned staff), exactly like
-- returned_by_* and the crew_photographer_name snapshot columns on this table.
-- No index — nothing filters or joins on these.
--
-- ANTI-REGRESSION
-- ---------------
-- Display-only. No guard, RPC, trigger or availability computation may ever
-- read these columns. update_reservation_status_v1 is deliberately NOT touched
-- (lessons #22 / #25 / #23) — the stamp is a separate PATCH after the RPC, so a
-- failed stamp leaves NULL and the UI falls back rather than affecting the
-- status change or inventory.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS approved_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by_name     text;

COMMENT ON COLUMN public.reservations_new.approved_by_name IS
  'Display-only audit stamp: the staff user who actually moved the request to מאושר, derived server-side from the JWT. Never read by any guard, RPC or availability computation. NULL => no actor recorded (pre-feature row, or the stamp write failed).';
