-- ============================================================================
-- Migration 025: Add SELECT RLS policies to reservation_items
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   reservation_items has RLS enabled but ZERO policies, which means every
--   anon/authenticated SELECT returns an empty set. Symptoms:
--     * Admin reservations modal showed "ציוד (0 פריטים)" for every row
--     * Student "ההזמנות שלי" page showed "0 פריטים" on each card
--     * Data was correctly written to the table by create_reservation_v2
--       (service_role bypasses RLS), but no client could read it back.
--
--   The fix mirrors the policies on reservations_new:
--     * anon: full read access (for availability calculations on the public
--       submission form — we already expose reservation dates anyway)
--     * authenticated staff: full read access
--     * students: read only items belonging to their own reservation
-- ============================================================================

BEGIN;

-- Anon: read all items (matches reservations_new "Anon can view reservations
-- for availability" policy — availability math needs to see every item).
CREATE POLICY "Anon can view reservation_items for availability"
  ON reservation_items FOR SELECT
  TO anon
  USING (true);

-- Staff: read everything
CREATE POLICY "Staff can view all reservation_items"
  ON reservation_items FOR SELECT
  TO authenticated
  USING (is_staff_member());

-- Students: read items tied to a reservation whose email matches their JWT
CREATE POLICY "Students can view own reservation_items"
  ON reservation_items FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM reservations_new r
      WHERE r.id = reservation_items.reservation_id
        AND (auth.jwt() ->> 'email') = r.email
    )
  );

COMMIT;

-- Verify after apply:
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='reservation_items';
--   -- expect 3 rows
