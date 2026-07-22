-- Tighten read access for the student reservation-update feature.
--
-- The original feature migrations used read-all policies so the student and
-- warehouse clients could query the two new tables directly. Unlike public
-- availability data, these rows contain student_email, staff_message and the
-- student's requested equipment changes. They must not be exposed to anon
-- callers or to other authenticated students.

BEGIN;

DROP POLICY IF EXISTS "read_riu" ON public.reservation_item_updates;
DROP POLICY IF EXISTS "staff_read_riu" ON public.reservation_item_updates;
DROP POLICY IF EXISTS "student_read_own_riu" ON public.reservation_item_updates;

CREATE POLICY "staff_read_riu"
  ON public.reservation_item_updates
  FOR SELECT
  TO authenticated
  USING (public.is_staff_member());

CREATE POLICY "student_read_own_riu"
  ON public.reservation_item_updates
  FOR SELECT
  TO authenticated
  USING (
    lower(student_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS "read_rpi" ON public.reservation_pending_items;
DROP POLICY IF EXISTS "staff_read_rpi" ON public.reservation_pending_items;
DROP POLICY IF EXISTS "student_read_own_rpi" ON public.reservation_pending_items;

CREATE POLICY "staff_read_rpi"
  ON public.reservation_pending_items
  FOR SELECT
  TO authenticated
  USING (public.is_staff_member());

CREATE POLICY "student_read_own_rpi"
  ON public.reservation_pending_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.reservation_item_updates u
       WHERE u.id = reservation_pending_items.update_id
         AND lower(u.student_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
  );

COMMIT;
