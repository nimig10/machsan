-- ─────────────────────────────────────────────────────────────────────────────
-- External-loan restriction for equipment
--
-- Adds two columns on public.equipment to let warehouse staff keep sensitive
-- gear inside campus:
--   * external_loan_restricted — when TRUE the whole item is blocked from the
--     two loan types that physically remove gear from campus: 'פרטית' (private)
--     and 'הפקה' (production). The item simply never appears in those flows.
--   * external_loan_hold_count — number of working units to HOLD BACK from
--     external loans (e.g. keep 3 of 6 SM58 mics on campus at all times).
--
-- Both are optional with a safe DEFAULT, so existing rows are unaffected.
-- They live on the equipment row (not equipment_units) because the loan form
-- loads equipment via `select("*")` and never fetches individual unit rows —
-- a per-unit flag would not round-trip. A count on the row always loads.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS external_loan_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_loan_hold_count integer NOT NULL DEFAULT 0;
