-- Stage 12 Session A — create public.loan_type_filters table.
-- Replaces store.categoryLoanTypes (loanType → allowed equipment classifications).
-- Blob retired in migration 20260429190000.

CREATE TABLE IF NOT EXISTS public.loan_type_filters (
  loan_type      text        PRIMARY KEY,
  allowed_types  text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER loan_type_filters_touch_updated_at
  BEFORE UPDATE ON public.loan_type_filters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.loan_type_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_loan_type_filters" ON public.loan_type_filters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "staff_all_loan_type_filters" ON public.loan_type_filters
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('staff','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('staff','admin')
    )
  );

CREATE POLICY "anon_read_loan_type_filters" ON public.loan_type_filters
  FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.loan_type_filters;
