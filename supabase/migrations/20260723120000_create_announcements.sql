-- 20260723120000_create_announcements.sql
--
-- Feature: one-off daily announcement shown to users in a floating modal on
-- their first entry of the day ("a big update just shipped — here is what
-- changed"). The admin writes it in הגדרות מערכת, targets an audience, and
-- optionally attaches a video from the existing user-guide video library.
--
-- WHY A TABLE AND NOT site_settings
-- ---------------------------------
-- Every client loads the whole site_settings blob on boot. An announcement
-- aimed at staff would land in every student's browser and be readable there.
-- Both tables below are RLS-on with NO anon/authenticated policy at all
-- (service-role only, exactly like staff_schedule_* and lesson_calendar_events)
-- so the text is only ever released by /api/announcement, which checks the
-- caller's audience server-side from their JWT.
--
-- HARD GUARANTEE — display only:
--   * No RPC, guard, trigger, status transition or availability computation
--     reads either table. No announcement ⇒ nothing renders, nothing changes.
--   * Nothing here touches reservations, equipment, lessons or studios.

CREATE TABLE IF NOT EXISTS public.announcements (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title             text        NOT NULL,
  body              text        NOT NULL DEFAULT '',
  -- Who sees it. Matched server-side against the caller's live role flags in
  -- public.users; a multi-role user matches on ANY of their flags (PR #73).
  audience          text        NOT NULL DEFAULT 'all'
                                CHECK (audience IN ('all','students','lecturers','staff')),
  -- On how many DISTINCT days a given user is shown this announcement.
  -- 1 = once ever; 2 = once today and once on the next day they log in.
  display_days      smallint    NOT NULL DEFAULT 1 CHECK (display_days IN (1,2)),
  -- SNAPSHOT of the chosen library video, not a reference: editing or deleting
  -- the video in site_settings afterwards must not break a published
  -- announcement (same reasoning as crew_photographer_name / original_items).
  video_url         text,
  video_title       text,
  video_orientation text        CHECK (video_orientation IN ('landscape','vertical')),
  active            boolean     NOT NULL DEFAULT true,
  published_at      timestamptz NOT NULL DEFAULT now(),
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- At most one announcement is live at a time. "פרסם כהודעה חדשה" deactivates
-- the current row and inserts a new one; older rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_one_active
  ON public.announcements (active) WHERE active;

CREATE TRIGGER announcements_touch_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- One row per (announcement, user, day-it-was-shown).
--
-- The primary key does all the work:
--   * COUNT(*) per (announcement_id, user_id) = on how many DISTINCT days the
--     user has already seen it → compared against announcements.display_days.
--   * A row for today = "already shown today, do not show again this session".
--   * INSERT ... ON CONFLICT DO NOTHING makes recording a view idempotent, so
--     a page refresh cannot inflate the count.
--
-- user_id has NO FK on purpose (lesson #37): the record must survive the user
-- row being deleted, and a dangling id is harmless for a display-only counter.
CREATE TABLE IF NOT EXISTS public.announcement_views (
  announcement_id bigint      NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  seen_on         date        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id, seen_on)
);

CREATE INDEX IF NOT EXISTS idx_announcement_views_lookup
  ON public.announcement_views (announcement_id, user_id);

-- RLS: service_role only. No anon/authenticated policy is granted, so the
-- supabase client cannot read either table directly — /api/announcement is the
-- only way in, and it decides what the caller is allowed to see.
ALTER TABLE public.announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_announcements" ON public.announcements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_announcement_views" ON public.announcement_views
  FOR ALL TO service_role USING (true) WITH CHECK (true);
