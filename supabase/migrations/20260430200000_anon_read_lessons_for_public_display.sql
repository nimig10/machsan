-- Public display pages (daily-table, public-display) call listLessons() with
-- the anon key. The lessons table only had an `authenticated` SELECT policy,
-- so anon callers got 0 rows. Add explicit anon read access.
CREATE POLICY "anon_read_lessons" ON public.lessons
  FOR SELECT TO anon USING (true);
