-- Productions board — keep the crew SNAPSHOT on reservations fresh.
--
-- Bug (confirmed in prod 2026-06-13): a production's equipment-loan reservation
-- carries a crew snapshot (crew_photographer_name/phone + crew_sound_name/phone)
-- captured at the moment the equipment list is submitted. When a crew role is
-- approved AFTER submission (e.g. sound approved hours after the list was sent),
-- production_crew_change_recheck_v1 ran — but it only ever UPDATEd `status`,
-- never the crew_* snapshot columns. So crew_sound_name stayed NULL forever.
--
-- Effect was twofold:
--   1. Warehouse control board never showed the sound person (render is gated
--      on crew_sound_name).
--   2. getProductionCertBlockers reads crew_sound_name off the row; an empty
--      value meant the (certified!) sound person's certs were never credited,
--      so sound equipment was falsely blocked with "דרושה הסמכה".
--
-- PR #45 (20260604120000) only derives the snapshot AT submit time and never
-- backfilled existing rows. This migration:
--   (1) extends production_crew_change_recheck_v1 to ALSO refresh the crew
--       snapshot on linked, non-terminal reservations from the currently
--       approved crew — so every future approve/change keeps it correct;
--   (2) runs a one-time, fill-only backfill for existing reservations whose
--       snapshot was left empty.
--
-- The cert-recheck / flip-to-'ממתין' logic is preserved byte-for-byte; only the
-- snapshot refresh is added.

CREATE OR REPLACE FUNCTION public.production_crew_change_recheck_v1(
  p_production_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_res            record;
  v_item           record;
  v_photog_id      text;
  v_sound_id       text;
  v_photog_name    text;
  v_photog_phone   text;
  v_sound_name     text;
  v_sound_phone    text;
  v_flipped_ids    text[] := ARRAY[]::text[];
  v_uncertified    boolean;
BEGIN
  IF p_production_id IS NULL OR p_production_id = '' THEN
    RAISE EXCEPTION 'production_crew_change_recheck_v1: p_production_id is required';
  END IF;

  -- Snapshot current approved photographer + sound on this production
  -- (NULL if role is not currently filled). Names/phones come along so we can
  -- refresh the reservation snapshot below.
  SELECT pc.student_id, s.name, s.phone
    INTO v_photog_id, v_photog_name, v_photog_phone
    FROM public.production_crew pc
    LEFT JOIN public.students s ON s.id = pc.student_id
   WHERE pc.production_id = p_production_id
     AND pc.role          = 'photographer'
     AND pc.status        = 'approved'
   LIMIT 1;

  SELECT pc.student_id, s.name, s.phone
    INTO v_sound_id, v_sound_name, v_sound_phone
    FROM public.production_crew pc
    LEFT JOIN public.students s ON s.id = pc.student_id
   WHERE pc.production_id = p_production_id
     AND pc.role          = 'sound'
     AND pc.status        = 'approved'
   LIMIT 1;

  -- Refresh the crew snapshot on linked, non-terminal reservations so the
  -- warehouse view + cert-gate always reflect the currently approved crew.
  -- Conservative: only write a role that currently HAS approved crew; never
  -- blank a column (crew removal is already handled by the cert flip below).
  -- The DISTINCT guard avoids touching updated_at when nothing changed.
  UPDATE public.reservations_new r
     SET crew_photographer_name  = CASE WHEN v_photog_id IS NOT NULL THEN COALESCE(v_photog_name,'')  ELSE r.crew_photographer_name  END,
         crew_photographer_phone = CASE WHEN v_photog_id IS NOT NULL THEN COALESCE(v_photog_phone,'') ELSE r.crew_photographer_phone END,
         crew_sound_name         = CASE WHEN v_sound_id  IS NOT NULL THEN COALESCE(v_sound_name,'')   ELSE r.crew_sound_name         END,
         crew_sound_phone        = CASE WHEN v_sound_id  IS NOT NULL THEN COALESCE(v_sound_phone,'')  ELSE r.crew_sound_phone        END,
         updated_at = NOW()
   WHERE r.production_id = p_production_id
     AND r.status IN ('מאושר','אישור ראש מחלקה','ממתין')
     AND (
          (v_photog_id IS NOT NULL AND COALESCE(r.crew_photographer_name,'')  IS DISTINCT FROM COALESCE(v_photog_name,''))
       OR (v_photog_id IS NOT NULL AND COALESCE(r.crew_photographer_phone,'') IS DISTINCT FROM COALESCE(v_photog_phone,''))
       OR (v_sound_id  IS NOT NULL AND COALESCE(r.crew_sound_name,'')         IS DISTINCT FROM COALESCE(v_sound_name,''))
       OR (v_sound_id  IS NOT NULL AND COALESCE(r.crew_sound_phone,'')        IS DISTINCT FROM COALESCE(v_sound_phone,''))
     );

  FOR v_res IN
    SELECT id, status
      FROM public.reservations_new
     WHERE production_id = p_production_id
       AND status IN ('מאושר','אישור ראש מחלקה','ממתין')
  LOOP
    v_uncertified := FALSE;

    FOR v_item IN
      SELECT equipment_id
        FROM public.reservation_items
       WHERE reservation_id = v_res.id
         AND equipment_id IS NOT NULL
    LOOP
      IF NOT public.crew_is_certified_for_equipment(v_photog_id, v_sound_id, v_item.equipment_id) THEN
        v_uncertified := TRUE;
        EXIT;
      END IF;
    END LOOP;

    IF v_uncertified THEN
      IF v_res.status <> 'ממתין' THEN
        UPDATE public.reservations_new
           SET status     = 'ממתין',
               updated_at = NOW()
         WHERE id = v_res.id;
        v_flipped_ids := array_append(v_flipped_ids, v_res.id);

        INSERT INTO public.activity_logs (
          user_id, user_name, action, entity, entity_id, details
        ) VALUES (
          'system', 'production_crew_recheck',
          'reservation_status_flip',
          'reservation', v_res.id,
          jsonb_build_object(
            'production_id',     p_production_id,
            'old_status',        v_res.status,
            'new_status',        'ממתין',
            'reason',            'crew_change_uncertified',
            'photographer_id',   v_photog_id,
            'sound_id',          v_sound_id
          )
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'flipped',     v_flipped_ids,
    'photog_id',   v_photog_id,
    'sound_id',    v_sound_id
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.production_crew_change_recheck_v1(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.production_crew_change_recheck_v1(text) TO service_role;

-- ── One-time backfill ───────────────────────────────────────────────────────
-- Fill (only where empty) the crew snapshot of existing production reservations
-- from the currently approved crew. Covers rows frozen before a role was
-- approved. Idempotent: re-running changes nothing once filled.

UPDATE public.reservations_new r
   SET crew_photographer_name  = s.name,
       crew_photographer_phone = COALESCE(s.phone,''),
       updated_at = NOW()
  FROM public.production_crew pc
  JOIN public.students s ON s.id = pc.student_id
 WHERE pc.production_id = r.production_id
   AND pc.role          = 'photographer'
   AND pc.status        = 'approved'
   AND r.loan_type      = 'הפקה'
   AND r.production_id IS NOT NULL
   AND r.status IN ('מאושר','אישור ראש מחלקה','ממתין','באיחור','פעילה')
   AND COALESCE(r.crew_photographer_name,'') = '';

UPDATE public.reservations_new r
   SET crew_sound_name  = s.name,
       crew_sound_phone = COALESCE(s.phone,''),
       updated_at = NOW()
  FROM public.production_crew pc
  JOIN public.students s ON s.id = pc.student_id
 WHERE pc.production_id = r.production_id
   AND pc.role          = 'sound'
   AND pc.status        = 'approved'
   AND r.loan_type      = 'הפקה'
   AND r.production_id IS NOT NULL
   AND r.status IN ('מאושר','אישור ראש מחלקה','ממתין','באיחור','פעילה')
   AND COALESCE(r.crew_sound_name,'') = '';
