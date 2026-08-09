-- 20260809120000_create_night_training.sql
--
-- Feature: the night-training theory exam (מבחן לילה) and the end-of-night
-- closing checklist (צ'ק ליסט נעילה), ported into the app from a standalone
-- tool that stored its results in a Google Sheet via Apps Script.
--
-- WHY TABLES AND NOT site_settings / a client-writable table
-- ---------------------------------------------------------
-- The exam decides nothing by itself, but it produces the "עבר עיוני" marker a
-- staff member acts on when granting cert_night_studio. If a student could
-- write their own attempt row, that marker would be forgeable, and the whole
-- point of moving scoring off the browser would be lost. All three tables are
-- therefore RLS-on with NO anon/authenticated policy at all (service-role only,
-- exactly like announcements / staff_schedule_* / lesson_calendar_events) and
-- /api/night-training is the only way in. It resolves the caller's identity and
-- eligibility from their JWT, never from the request body (lesson #37+#41).
--
-- ⚠️ NEVER GRANT anon OR authenticated A POLICY ON THESE TABLES — ESPECIALLY
-- night_quiz_answers.correct_text, WHICH IS LITERALLY THE ANSWER KEY.
-- A student holding a JWT could then run
--   supabase.from("night_quiz_answers").select("correct_text")
-- and read the whole key. night_quiz_attempts is just as sensitive: (seed,
-- question_ids) together let anyone regenerate a quiz — and its answers —
-- offline. A convenience read policy here silently defeats server-side scoring.
--
-- HARD GUARANTEE — display and record only:
--   * Passing grants NOTHING automatically. Nothing here writes to
--     student_certifications; cert_night_studio stays a manual staff decision,
--     and the night-booking gate (hasNightCert in PublicForm.jsx) is untouched.
--   * No RPC, guard, trigger, status transition or availability computation
--     reads any of these tables.
--   * Nothing here touches reservations, equipment, lessons or studios.

-- ─────────────────────────────────────────────────────────────────────────────
-- One row per ATTEMPT. Created when the student opens the quiz, completed when
-- they submit — the two-phase lifecycle is what makes stateless scoring safe.
--
-- The presentation (which 15 questions, in what order, with options shuffled
-- how) is NOT stored. It is regenerated on demand from (seed, question_ids) by
-- api/_night-quiz.js, which is also the only place a correct answer lives. That
-- keeps this table small and means a page refresh can hand the student back the
-- byte-identical quiz they left.
CREATE TABLE IF NOT EXISTS public.night_quiz_attempts (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Identity SNAPSHOT, deliberately WITHOUT a FK to students (lesson #37): the
  -- record of who was examined must survive the student row being deleted at
  -- the end of the year, and a dangling id is harmless for a display-only log.
  student_id       text        NOT NULL,
  student_name     text        NOT NULL,
  student_email    text,
  track_name       text,
  track_type       text        CHECK (track_type IS NULL OR track_type IN ('sound','cinema')),

  -- Which bank this attempt was drawn from. api/night-training.js refuses to
  -- score an attempt whose bank has changed under it (bank_changed) rather than
  -- silently mis-scoring, so a deploy mid-exam costs at most one TTL window.
  bank_version     integer     NOT NULL,
  seed             text        NOT NULL,
  question_ids     integer[]   NOT NULL,   -- typed array; precedent: tracks.loan_types
  total_questions  smallint    NOT NULL,

  started_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,

  -- submitted_at is the CLAIM column. Scoring does a conditional UPDATE filtered
  -- on submitted_at IS NULL; zero rows back means somebody already submitted, so
  -- the second request is rejected. That single filter is the entire replay
  -- defence: without it, the fail screen (which names the questions you got
  -- wrong) becomes an oracle — resubmit varying one answer at a time and the
  -- full key falls out in under 60 requests. Do not remove the filter, and do
  -- not "simplify" it into a read-then-write.
  submitted_at     timestamptz,
  score            smallint,
  passed           boolean,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT night_quiz_attempts_score_range
    CHECK (score IS NULL OR (score >= 0 AND score <= total_questions)),
  -- A row is either fully unsubmitted or fully scored — never half-written.
  CONSTRAINT night_quiz_attempts_result_together
    CHECK ((submitted_at IS NULL) = (score IS NULL)
       AND (submitted_at IS NULL) = (passed IS NULL))
);

CREATE TRIGGER night_quiz_attempts_touch_updated_at
  BEFORE UPDATE ON public.night_quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_night_quiz_attempts_student
  ON public.night_quiz_attempts (student_id, started_at DESC);

-- "עבר עיוני" is EXISTS(passed) per student; a partial index makes deriving it
-- for the whole cohort one cheap scan.
CREATE INDEX IF NOT EXISTS idx_night_quiz_attempts_passed
  ON public.night_quiz_attempts (student_id) WHERE passed;

-- The staff panel lists submitted attempts only — abandoned rows (a student who
-- opened the quiz and closed the tab) stay as audit but are noise in the UI.
CREATE INDEX IF NOT EXISTS idx_night_quiz_attempts_submitted
  ON public.night_quiz_attempts (submitted_at DESC) WHERE submitted_at IS NOT NULL;

-- NOTE: deliberately NO partial unique index on "one open attempt per student".
-- "Open" is a temporal condition (unsubmitted AND unexpired) and an index cannot
-- express expiry, so such a constraint would wedge out any student who once
-- abandoned an attempt. The endpoint enforces it instead: reuse the newest open
-- unexpired attempt, otherwise insert. Stale open rows are inert.

-- ─────────────────────────────────────────────────────────────────────────────
-- One row per PRESENTED question of a submitted attempt.
--
-- Normalized instead of a wrong_details jsonb column: 15 rows per attempt is
-- nothing, it keeps CLAUDE.md's "no jsonb for domain arrays" rule intact, and it
-- makes "which question does everyone fail?" a plain GROUP BY.
--
-- The *_text columns are write-once documentary SNAPSHOTS so a staff member
-- reviewing an old attempt sees the wording the student actually faced, even
-- after the code bank is edited (same reasoning as reservations_new.original_items,
-- lesson #35+#44) — but as plain text columns, not jsonb.
CREATE TABLE IF NOT EXISTS public.night_quiz_answers (
  attempt_id      bigint      NOT NULL REFERENCES public.night_quiz_attempts(id) ON DELETE CASCADE,
  question_number smallint    NOT NULL,   -- 1..15, position AS PRESENTED
  question_id     integer     NOT NULL,   -- id in the code bank
  question_text   text        NOT NULL,
  chosen_text     text,                   -- NULL = left unanswered
  correct_text    text        NOT NULL,   -- ⚠️ ANSWER KEY — staff-only, never sent to a student
  is_correct      boolean     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_night_quiz_answers_question
  ON public.night_quiz_answers (question_id, is_correct);

-- ─────────────────────────────────────────────────────────────────────────────
-- One row per reported closing. Append-only, so no updated_at / trigger.
CREATE TABLE IF NOT EXISTS public.night_closing_checklists (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  student_id    text        NOT NULL,     -- snapshot, no FK (lesson #37)
  student_name  text        NOT NULL,
  student_email text,
  track_name    text,

  items_total   smallint    NOT NULL,     -- length of the list at the time
  list_version  integer     NOT NULL,

  -- The "night of" date, NOT the calendar date. A closing is reported after
  -- midnight by definition (the alarm-code step gives you 3 minutes to leave),
  -- so a 01:30 report belongs to the night that started the previous evening —
  -- which is the night staff will look for. api/night-training.js computes it as
  -- the Asia/Jerusalem date shifted back 6 hours; completed_at keeps the exact
  -- instant.
  completed_on  date        NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_night_closing_checklists_student
  ON public.night_closing_checklists (student_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_night_closing_checklists_day
  ON public.night_closing_checklists (completed_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: service_role only. See the answer-key warning at the top of this file.
ALTER TABLE public.night_quiz_attempts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_quiz_answers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.night_closing_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_night_quiz_attempts" ON public.night_quiz_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_night_quiz_answers" ON public.night_quiz_answers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_night_closing_checklists" ON public.night_closing_checklists
  FOR ALL TO service_role USING (true) WITH CHECK (true);
