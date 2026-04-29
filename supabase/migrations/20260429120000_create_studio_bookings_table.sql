-- Stage 10 Session A — normalize store.studio_bookings JSONB blob into a real
-- table. Mirror of Stage 7 (lecturers) / Stage 8 (lessons) / Stage 9 (studios)
-- pattern. Reads still go to the blob; this migration is purely additive
-- (CREATE TABLE + RLS only). Sessions B will flip readers, Session C drops the blob.
--
-- Key decisions (per Stage 10 plan):
-- - lesson_auto bookings (281/308) are NOT stored here — they are regenerated
--   in-memory from lessons.schedule on every load via buildLessonStudioBookings.
--   The table only stores the 27 user-driven bookings (15 student + 8 team + others).
-- - student_email + auth.jwt() email is the ownership boundary for RLS.

CREATE TABLE IF NOT EXISTS public.studio_bookings (
  id                  text         PRIMARY KEY,
  studio_id           text         NOT NULL,
  date                text         NOT NULL,
  start_time          text,
  end_time            text,
  is_night            boolean      NOT NULL DEFAULT false,
  booking_kind        text,
  owner_type          text,
  status              text,
  -- student fields
  student_id          text,
  student_name        text,
  student_email       text,
  student_phone       text,
  -- team fields
  team_member_id      text,
  team_member_name    text,
  -- lesson refs (rare — for non-auto lesson bookings)
  lesson_id           text,
  lesson_auto         boolean      NOT NULL DEFAULT false,
  course_name         text,
  instructor_name     text,
  track               text,
  subject             text,
  -- meta
  recurring_group_id  text,
  notes               text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- Lookup index for cell occupancy check (find bookings for a studio on a date).
CREATE INDEX IF NOT EXISTS studio_bookings_studio_date_idx
  ON public.studio_bookings (studio_id, date);

-- Date range scans (today's bookings, weekly views).
CREATE INDEX IF NOT EXISTS studio_bookings_date_idx
  ON public.studio_bookings (date);

-- Owner lookup for "my bookings" view + RLS check.
CREATE INDEX IF NOT EXISTS studio_bookings_student_email_idx
  ON public.studio_bookings (lower(student_email))
  WHERE student_email IS NOT NULL;

-- Reuse touch_updated_at() function defined in Stage 6 (students migration).
DROP TRIGGER IF EXISTS studio_bookings_touch_updated_at ON public.studio_bookings;
CREATE TRIGGER studio_bookings_touch_updated_at
  BEFORE UPDATE ON public.studio_bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Public reads (PublicDisplay/PublicDailyTable) + authenticated owner-scoped
-- writes (PublicForm) + staff full CRUD (StudioBookingPage admin views).

ALTER TABLE public.studio_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_bookings_service_role_all ON public.studio_bookings;
CREATE POLICY studio_bookings_service_role_all
  ON public.studio_bookings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS studio_bookings_staff_all ON public.studio_bookings;
CREATE POLICY studio_bookings_staff_all
  ON public.studio_bookings
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Anon + authenticated can SELECT (display pages don't require login;
-- studio availability is non-sensitive).
DROP POLICY IF EXISTS studio_bookings_public_read ON public.studio_bookings;
CREATE POLICY studio_bookings_public_read
  ON public.studio_bookings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users can INSERT bookings only with their own email
-- (PublicForm self-service flow). Staff bypass via studio_bookings_staff_all.
DROP POLICY IF EXISTS studio_bookings_owner_insert ON public.studio_bookings;
CREATE POLICY studio_bookings_owner_insert
  ON public.studio_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_email IS NOT NULL
    AND lower(student_email) = lower(auth.jwt() ->> 'email')
  );

-- Authenticated users can UPDATE/DELETE only their own bookings.
DROP POLICY IF EXISTS studio_bookings_owner_update ON public.studio_bookings;
CREATE POLICY studio_bookings_owner_update
  ON public.studio_bookings
  FOR UPDATE
  TO authenticated
  USING (
    student_email IS NOT NULL
    AND lower(student_email) = lower(auth.jwt() ->> 'email')
  )
  WITH CHECK (
    student_email IS NOT NULL
    AND lower(student_email) = lower(auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS studio_bookings_owner_delete ON public.studio_bookings;
CREATE POLICY studio_bookings_owner_delete
  ON public.studio_bookings
  FOR DELETE
  TO authenticated
  USING (
    student_email IS NOT NULL
    AND lower(student_email) = lower(auth.jwt() ->> 'email')
  );

-- Enable realtime so clients (admin + public pages) get live updates.
ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_bookings;
