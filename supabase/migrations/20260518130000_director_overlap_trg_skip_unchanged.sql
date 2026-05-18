-- production_dates_director_overlap_trg fired on every UPDATE that touched
-- start_date / end_date / production_id columns (Postgres "UPDATE OF" matches
-- the SET clause syntax, not the actual value change). When two pre-existing
-- productions of the same director already overlapped before the trigger was
-- installed, every later upsert touching their dates failed even though the
-- caller wasn't introducing new overlap.
--
-- Fix: compare OLD and NEW; skip the check when nothing changed.

CREATE OR REPLACE FUNCTION public.production_dates_director_overlap_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.start_date    IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date      IS NOT DISTINCT FROM OLD.end_date
     AND NEW.production_id IS NOT DISTINCT FROM OLD.production_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.check_director_no_overlap_for_production(NEW.production_id);
  RETURN NEW;
END;
$$;
