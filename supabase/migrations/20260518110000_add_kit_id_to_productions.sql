-- Add optional kit binding to productions. When non-null, restricts the
-- equipment selection in the loan form (loan_type='הפקה') to items inside
-- the bound kit. ON DELETE SET NULL: if the kit is removed, the production
-- silently degrades to "general" (no restriction).
ALTER TABLE public.productions
  ADD COLUMN IF NOT EXISTS kit_id text
  REFERENCES public.kits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS productions_kit_id_idx
  ON public.productions (kit_id) WHERE kit_id IS NOT NULL;
