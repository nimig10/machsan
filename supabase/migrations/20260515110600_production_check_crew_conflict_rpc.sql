-- Productions board (לוח הפקות) — Session 7/N: crew-conflict check.
-- Returns ok=true when student has NO time-overlap with any other production
-- where they're already an approved crew member. Used both as preview
-- (frontend) and as a hard guard inside production_approve_crew_v1.
-- Time semantics match create_reservation_v2 (`[)` bounds, Asia/Jerusalem).

CREATE OR REPLACE FUNCTION public.production_check_crew_conflict_v1(
  p_student_id    text,
  p_production_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_conflicts jsonb;
BEGIN
  IF p_student_id IS NULL OR p_production_id IS NULL THEN
    RAISE EXCEPTION 'production_check_crew_conflict_v1: p_student_id and p_production_id are required';
  END IF;

  WITH this_prod AS (
    SELECT pd.id,
           (pd.start_date + pd.start_time) AT TIME ZONE 'Asia/Jerusalem' AS s_start,
           (pd.end_date   + pd.end_time)   AT TIME ZONE 'Asia/Jerusalem' AS s_end
      FROM public.production_dates pd
     WHERE pd.production_id = p_production_id
  ),
  other_dates AS (
    SELECT
      pc.production_id,
      pc.role,
      p.title  AS other_title,
      pd.id    AS other_date_id,
      pd.start_date,
      pd.start_time,
      pd.end_date,
      pd.end_time,
      (pd.start_date + pd.start_time) AT TIME ZONE 'Asia/Jerusalem' AS o_start,
      (pd.end_date   + pd.end_time)   AT TIME ZONE 'Asia/Jerusalem' AS o_end
    FROM public.production_crew pc
    JOIN public.productions      p  ON p.id  = pc.production_id
    JOIN public.production_dates pd ON pd.production_id = pc.production_id
   WHERE pc.student_id   = p_student_id
     AND pc.status       = 'approved'
     AND pc.production_id <> p_production_id
  ),
  hits AS (
    SELECT
      o.production_id,
      o.role,
      o.other_title,
      o.other_date_id,
      o.start_date,
      o.start_time,
      o.end_date,
      o.end_time
    FROM other_dates o
    JOIN this_prod   t
      ON tstzrange(o.o_start, o.o_end, '[)')
      && tstzrange(t.s_start, t.s_end, '[)')
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) INTO v_conflicts FROM hits h;

  RETURN jsonb_build_object(
    'ok',        (jsonb_array_length(v_conflicts) = 0),
    'conflicts', v_conflicts
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_check_crew_conflict_v1(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_check_crew_conflict_v1(text,text) TO authenticated, service_role;
