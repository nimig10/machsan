-- Productions board (לוח הפקות) — Session 4/N: link reservations_new to
-- productions. Two nullable FK columns are added; existing rows are
-- unaffected (NULL) and the new create_reservation_v2 pass-through is
-- added in the next migration.
-- ON DELETE SET NULL on production_id so production_delete_v1 can cancel
-- reservations and then hard-delete the production without breaking the
-- audit trail (cancelled reservation rows are preserved with production_id=NULL).

ALTER TABLE public.reservations_new
  ADD COLUMN IF NOT EXISTS production_id      text
    REFERENCES public.productions(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_date_id text
    REFERENCES public.production_dates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservations_new_production_id_idx
  ON public.reservations_new (production_id)
  WHERE production_id IS NOT NULL;
