-- 029_create_students_tables.sql
-- Stage 6 — Step 2: Schema for normalizing certifications.students out of the JSONB blob.
--
-- This is DDL ONLY. No backfill yet. Tables start empty; the JSONB blob in
-- store.certifications remains the source of truth until later steps wire
-- dual-write and migrate reads.
--
-- Tables created:
--   public.certification_types       — was certifications.types
--   public.tracks                    — merge of certifications.tracks + trackSettings
--   public.students                  — was certifications.students (ID + profile)
--   public.student_certifications    — was students[].certs map
--
-- Decisions (locked in with user before writing):
--   • Text PKs for students/cert_types — keep stu_XXX / cert_XXX backward-compat
--   • tracks: uuid PK + UNIQUE(name) — name stays the natural key for client code
--   • students.track_name (transitional) + students.track_id (FK) — drop name later
--   • student_certifications.status: CHECK in ('עבר','לא עבר') — extensible via ALTER
--   • RLS NOT enabled here — that's Stage 6 Step 7 after dual-write proven safe

-- ============================================================
-- ① certification_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.certification_types (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.certification_types IS
  'Stage 6 normalization of store.certifications.types. PK matches existing cert_XXXXXX strings.';

-- ============================================================
-- ② tracks (merged tracks + trackSettings)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tracks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  track_type text        NOT NULL CHECK (track_type IN ('cinema','sound')),
  loan_types text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tracks IS
  'Stage 6 normalization. Merges certifications.tracks (track_type) with certifications.trackSettings (loan_types). name is the natural key used by client code.';

-- ============================================================
-- ③ students
-- ============================================================
CREATE TABLE IF NOT EXISTS public.students (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  email      text,
  phone      text,
  track_name text,                                                            -- transitional, drop in Stage 7
  track_id   uuid        REFERENCES public.tracks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.students IS
  'Stage 6 normalization of store.certifications.students. PK matches existing stu_XXXXXX strings.';
COMMENT ON COLUMN public.students.track_name IS
  'TRANSITIONAL: client code currently writes track by name. Drop after read path migrated to track_id.';

CREATE INDEX IF NOT EXISTS students_track_id_idx    ON public.students (track_id);
CREATE INDEX IF NOT EXISTS students_track_name_idx  ON public.students (track_name);
CREATE INDEX IF NOT EXISTS students_email_lower_idx ON public.students (lower(email));

-- ============================================================
-- ④ student_certifications (junction with status)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.student_certifications (
  student_id   text        NOT NULL REFERENCES public.students(id)            ON DELETE CASCADE,
  cert_type_id text        NOT NULL REFERENCES public.certification_types(id) ON DELETE CASCADE,
  status       text        NOT NULL CHECK (status IN ('עבר','לא עבר')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, cert_type_id)
);

COMMENT ON TABLE public.student_certifications IS
  'Stage 6 normalization of students[].certs map. CHECK on status is extensible via ALTER.';

CREATE INDEX IF NOT EXISTS student_certifications_cert_type_idx
  ON public.student_certifications (cert_type_id);

-- ============================================================
-- updated_at auto-touch trigger (shared)
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_touch_updated_at ON public.students;
CREATE TRIGGER students_touch_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS student_certifications_touch_updated_at ON public.student_certifications;
CREATE TRIGGER student_certifications_touch_updated_at
  BEFORE UPDATE ON public.student_certifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
