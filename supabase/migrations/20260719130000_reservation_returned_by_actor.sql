-- 20260719130000_reservation_returned_by_actor.sql
--
-- WHY
-- ---
-- The archive shows WHEN a loan came back but never WHO handled it. Two
-- existing mechanisms look like they answer that and do not:
--
--   reservation_staff_assignments (PR #58) records the PLANNED handler picked
--   in the staff roster — an intention, not a fact. Nobody has to be assigned,
--   and the person who actually processed the return is often someone else.
--
--   activity_logs writes action='reservation_return' with a name, but only
--   from one of the two return paths, and its identity comes from the client
--   (sessionStorage) through an UNAUTHENTICATED endpoint — i.e. spoofable.
--
-- These two columns record the staff user who ACTUALLY clicked "הוחזר",
-- derived server-side from the JWT in api/update-reservation-status.js. That
-- placement means every path through the endpoint is covered, including the
-- dashboard button which carries no staff identity on the client at all.
--
-- NO FK on returned_by_staff_id: the name must survive deletion of the user
-- row (lesson #31 permits removing orphaned staff), exactly like the
-- crew_photographer_name / crew_sound_name snapshot columns on this table.
-- No index either — nothing filters or joins on these.
--
-- ANTI-REGRESSION
-- ---------------
-- Display-only. No guard, RPC, trigger or availability computation may ever
-- read these columns. update_reservation_status_v1 is deliberately NOT touched
-- (lessons #22 / #25 / #23) — the stamp is a separate PATCH after the RPC, so
-- a failed stamp leaves NULL and the UI falls back rather than affecting the
-- status change or inventory.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS returned_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS returned_by_name     text;

COMMENT ON COLUMN public.reservations_new.returned_by_name IS
  'Display-only audit stamp: the staff user who actually clicked הוחזר, derived server-side from the JWT. Never read by any guard, RPC or availability computation. NULL => no actor recorded (pre-feature row, or the stamp write failed) — UI falls back to the planned handler or "לא נרשם".';

COMMENT ON COLUMN public.reservations_new.returned_by_staff_id IS
  'auth/public.users id of the staff user who clicked הוחזר. Intentionally NOT a foreign key — the stamp must survive deletion of the user row.';
