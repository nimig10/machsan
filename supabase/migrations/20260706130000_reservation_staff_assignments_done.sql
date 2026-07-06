-- Add a personal-tracking "done" flag to reservation_staff_assignments so the
-- assigned staff member can tick off loan requests they've handled, from the
-- Staff Hub "משימות להיום" panel.
--
-- DISPLAY-ONLY: additive column, DEFAULT false. It does NOT participate in any
-- loan/reservation logic, RPC, or trigger — the loan flow never reads it. The
-- table stays fully decoupled from reservations (see PR #58 / lesson #23).
-- Written only via /api/staff-schedule (service role); toggled by the assigned
-- handler or an admin.

ALTER TABLE public.reservation_staff_assignments
  ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false;
