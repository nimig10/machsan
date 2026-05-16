-- Productions board: enforce the same 7-day maximum loan window as the
-- equipment loan form ("הפקה" loan_type). Since a production's shoot dates
-- are the source of truth for what gets borrowed, the constraint belongs
-- here too — preventing a director from publishing a 10-day shoot only to
-- be blocked at the loan step.
--
-- end_date - start_date <= 6  ⇒  inclusive range up to 7 days.
ALTER TABLE public.production_dates
  DROP CONSTRAINT IF EXISTS production_dates_max_7_days;
ALTER TABLE public.production_dates
  ADD CONSTRAINT production_dates_max_7_days
    CHECK ((end_date - start_date) <= 6);
