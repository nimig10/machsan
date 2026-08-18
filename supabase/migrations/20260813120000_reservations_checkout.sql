-- 20260813120000_reservations_checkout.sql
--
-- WHY THESE COLUMNS EXIST
--
-- Until now "פעילה" was never a value in this table. It was derived, live, in
-- the browser: getEffectiveStatus() in src/utils.js turned a row that was
-- status='מאושר' into "פעילה" the moment borrow_date+borrow_time passed. Nobody
-- ever touched the gear; the clock did it. Three things followed from that:
--
--   1. There is no record of the equipment actually leaving the warehouse, and
--      no record of WHO handed it over. approved_by_* answers "who approved",
--      returned_by_* answers "who took it back", and the middle of the story —
--      the only step where hardware physically moves — was anonymous.
--   2. A unit found broken AT THE MOMENT OF HANDOVER had nowhere to be recorded.
--      The return screen (PR #107) could say "came back damaged"; nothing could
--      say "went out damaged" or "was missing from the shelf".
--   3. An item the student did not take had to be removed through עריכת בקשה,
--      a different screen with a different mental model.
--
-- So the warehouse gets a checkout screen mirroring the return screen, and
-- "פעילה" becomes a real status written by a real person.
--
--
-- issued_at IS NOT DISPLAY-ONLY — IT IS THE ONLY LOAD-BEARING COLUMN HERE
--
-- Read that twice before deleting it as cosmetic. "באיחור" now means two
-- different things — "the gear is out and late" and "nobody ever came to pick
-- it up" — and status alone can no longer tell them apart. issued_at is what
-- picks which panel the warehouse sees, and it is also the gate that stops a
-- student from editing or cancelling a loan whose gear is already in their
-- hands (see 20260813120100). Because of that it is written by a BLOCKING
-- PATCH before the status RPC, never by the best-effort stampActor path that
-- carries returned_by_* / approved_by_*: a silent failure there would show a
-- checkout panel for gear that already left, and a second checkout would
-- decrement the item list all over again.
--
-- The other three columns ARE display-only, exactly like the stamps that came
-- before them: no FK (the name must survive deleting the user row, lesson #31),
-- no index (nothing filters, sorts or joins on them), and no guard, RPC,
-- trigger or availability computation may read them.
--
--
-- checkout_outcomes SHAPE  (exceptions only — "יוצא" is never stored)
--
--   { "v": 1,
--     "at": "2026-08-13T09:41:22.113Z",
--     "items": [ { "equipment_id": "1776079954421",
--                  "name": "כבל XLR",
--                  "units": [ { "unit_id": "1776079954421_3",
--                               "status": "פגום",
--                               "fault": "מחבר שבור" },
--                             { "unit_id": "1776079954421_5",
--                               "status": "החזר" } ] } ] }
--
-- Same contract as return_outcomes: a clean checkout leaves it NULL, and NULL
-- renders identically to every row written before the feature existed.
--
-- "החזר" is the checkout-only verdict: the student did not take this unit, so
-- the quantity on reservation_items drops and the unit goes straight back into
-- the available pool. "פגום"/"נעלם" are recorded but do NOT change quantities —
-- that asymmetry is deliberate and is the whole reason "החזר" exists as its own
-- state rather than being inferred.
--
--
-- ANTI-REGRESSION
--
--   1. NEVER add checkout_outcomes to save_edited_reservation_v1's SET list.
--      That RPC names twelve columns explicitly, so this one survives edits by
--      virtue of its ABSENCE — the mirror image of original_items, which needed
--      a jsonb_exists guard precisely because the client does send it.
--   2. issued_at, by contrast, IS read by application logic (panel selection +
--      the student-edit gate). It still must not enter any availability or
--      over-booking computation: what ties up stock is status, unchanged.
--   3. The unit_id values in checkout_outcomes are INDICATIVE, not forensic —
--      reservation_items.unit_id is still never populated, so the checkout
--      screen offers lowest-numbered healthy units. Never aggregate them.
--   4. restore_reservation_v1 does not carry these columns — the same known gap
--      it already has for original_items / return_outcomes / returned_by_* /
--      approved_by_*.

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS issued_at          timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS issued_by_name     text,
  ADD COLUMN IF NOT EXISTS checkout_outcomes  jsonb;

COMMENT ON COLUMN public.reservations_new.issued_at IS
  'When the warehouse actually handed the gear over. NOT display-only — this is the column that decides whether a request shows the checkout panel or the return panel (באיחור alone can no longer tell "out and late" from "never collected"), and it is the gate that blocks student edits/cancellation once the gear has left. Written by a BLOCKING PATCH in /api/update-reservation-status before the status RPC, filtered on issued_at=is.null so it can only ever be stamped once. Never enters an availability or over-booking computation — stock is still tied up by status alone.';

COMMENT ON COLUMN public.reservations_new.issued_by_staff_id IS
  'auth/public.users id of the staff user who handed the gear over, derived server-side from the JWT. Intentionally NOT a foreign key — the stamp must survive deletion of the user row (lesson #31). Display-only.';

COMMENT ON COLUMN public.reservations_new.issued_by_name IS
  'Display-only audit stamp: the staff user who actually performed the checkout, derived server-side from the JWT. NULL on rows filled in by this migration''s backfill (they were never handed over by a person) — the UI must render a "לא נרשם" branch, exactly like ReturnActor does.';

COMMENT ON COLUMN public.reservations_new.checkout_outcomes IS
  'Frozen documentation snapshot of the EXCEPTIONS recorded at checkout: {v,at,items:[{equipment_id,name,units:[{unit_id,status,fault?}]}]}. status is limited to (פגום, נעלם, החזר) — יוצא is never stored. Written once by /api/update-reservation-status on the transition to פעילה, before the status RPC runs. Display-only: never read by any guard, RPC, trigger or availability computation. unit_id values are INDICATIVE — never aggregate them. NULL => clean checkout, or the row predates the feature.';


-- ── ONE-TIME BACKFILL ───────────────────────────────────────────────────────
--
-- Without this, deploy day is a disaster in slow motion: every loan whose gear
-- is physically out right now sits in the table as status='מאושר' and was only
-- ever SHOWN as "פעילה" by the derivation we are deleting. The moment that
-- derivation goes, all of them revert to looking like un-collected requests,
-- the return panel disappears from every one of them, and the warehouse is
-- asked to "check out" gear that has been in a student's bag for a week.
--
-- So we materialise exactly what the screen displays today, and nothing more.
-- The two statements below are the SQL transcription of getEffectiveStatus as
-- it stands in the commit BEFORE this one:
--
--   מאושר + borrow passed                 -> was displayed as "פעילה"  (or
--   מאושר + borrow passed + return passed -> was displayed as "באיחור")
--
-- issued_by_name stays NULL on purpose. These rows were handed over by someone
-- the system never asked about, and inventing an actor would be a lie in an
-- audit column. "לא נרשם" is the honest rendering.
--
-- Idempotent: both statements are filtered on issued_at IS NULL, so re-running
-- the migration is a no-op. Timestamps are computed in Asia/Jerusalem to match
-- every other date computation in this schema (never current_date — lesson #26).

-- 1. Everything that had already been "collected" gets its handover stamp.
--
-- Lessons are excluded outright. They are generated from the timetable, never
-- handed over at a counter, and normalizeReservationsForArchive auto-archives
-- them to הוחזר — stamping one would offer a checkout screen for a loan no
-- human is ever meant to process.
UPDATE public.reservations_new
   SET issued_at = (
         borrow_date + COALESCE(NULLIF(borrow_time, '')::TIME, '00:00'::TIME)
       ) AT TIME ZONE 'Asia/Jerusalem'
 WHERE status IN ('מאושר', 'באיחור')
   AND issued_at IS NULL
   AND borrow_date IS NOT NULL
   AND loan_type IS DISTINCT FROM 'שיעור'
   AND COALESCE(lesson_auto, FALSE) = FALSE
   AND (
         borrow_date + COALESCE(NULLIF(borrow_time, '')::TIME, '00:00'::TIME)
       ) <= (NOW() AT TIME ZONE 'Asia/Jerusalem');

-- 2. Every stamped row that is still 'מאושר' becomes 'פעילה'.
--
-- ⚠️ Deliberately NOT filtered on "return time has not passed yet". A stamped
-- row left at 'מאושר' reads as checkoutState "half_issued" — the recovery state
-- for a checkout that died mid-write — and would put a CHECKOUT panel in front
-- of gear that is out and overdue. The rows whose return time has already
-- passed do not need special handling: they land on 'פעילה', and the very same
-- machinery that escalates any real checked-out loan takes them from there —
-- getEffectiveStatus and normalizeReservationsForArchive display them as
-- 'באיחור' immediately, and check-overdue.js writes it within five minutes.
-- That is exactly the path they were already on before this feature existed.
UPDATE public.reservations_new
   SET status = 'פעילה'
 WHERE status = 'מאושר'
   AND issued_at IS NOT NULL;
