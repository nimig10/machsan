-- Feature: student equipment-list updates — the "בדיקת עדכון" display flag.
--
-- reservations_new.pending_update_id points at the ONE update currently
-- awaiting warehouse review (reservation_item_updates.id), or NULL when there
-- is none. It exists so every surface that already loads a reservation row
-- (select "*") can show the "בדיקת עדכון" badge without an extra join or a
-- threaded prop.
--
-- DISPLAY-ONLY — same contract as original_items / returned_by_* (lessons
-- #35/#37): no guard, no RPC, no availability computation ever reads it.
-- The base status stays 'מאושר' while an update is pending, so the
-- inventory-blocking status set ('מאושר','באיחור','פעילה') is untouched.
-- Written and cleared ONLY by student_submit_reservation_update_v1 /
-- staff_review_reservation_update_v1.
--
-- No FK on purpose: the column is a hint, not a relation — a dangling id
-- (never expected, but conceivable after manual surgery) must not block
-- reservation writes. Consumers treat "no matching pending update row" the
-- same as NULL.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS pending_update_id bigint;
