-- 20260719120000_reservations_original_items.sql
--
-- WHY
-- ---
-- Staff can now edit quantities on a loan whose status is "באיחור" in order to
-- record a PARTIAL RETURN: the student brings back 2 of 3 items, staff reduces
-- the quantity, and the returned units are released back into the pool
-- immediately (availability is derived from reservation_items.quantity).
--
-- That release is exactly what we want operationally, but it destroys the
-- archive record: reservation_items serves BOTH as the live availability source
-- AND as the documentation of what was actually loaned. Once every item has been
-- decremented away, the archived ("הוחזר") request would document an EMPTY loan
-- instead of the gear that physically left the warehouse.
--
-- This column splits those two jobs apart:
--   reservation_items.quantity -> what is still OUT   (feeds availability)
--   reservations_new.original_items -> what WENT out  (feeds the archive)
--
-- The archive must always show the equipment list exactly as it stood while the
-- request was "פעילה", regardless of how many partial-return edits happened.
--
-- SHAPE
-- -----
-- [{ "equipment_id": "...", "name": "...", "quantity": 3 }, ...]
-- Written ONCE, on the first partial return of an overdue loan, and never
-- overwritten afterwards. NULL means "no partial return ever happened", and the
-- archive falls back to the live reservation_items — so every existing row and
-- every creation path is unaffected.
--
-- WHY JSONB HERE (deliberate exception to the CLAUDE.md rule)
-- -----------------------------------------------------------
-- CLAUDE.md forbids JSONB for *live domain arrays*. This is not one: it is a
-- FROZEN documentation snapshot — written once, never mutated, never queried
-- relationally, never joined, and read only by ArchivePage for display. It is
-- the direct analogue of the crew_photographer_name / crew_sound_name snapshot
-- columns that already live on this same table.
--
-- ANTI-REGRESSION
-- ---------------
-- No guard, RPC, trigger or availability computation may ever read this column.
-- reservation_items keeps its existing semantics untouched, including
-- CHECK (quantity > 0) — rows are still deleted at 0, so no zero-quantity rows
-- are introduced anywhere in the system.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS original_items jsonb;

COMMENT ON COLUMN public.reservations_new.original_items IS
  'Frozen documentation snapshot of the equipment list as it was when the loan went out (פעילה): [{equipment_id,name,quantity}]. Written once on the first partial return of an overdue loan. Display-only — never read by any guard, RPC or availability computation. NULL => fall back to live reservation_items.';
