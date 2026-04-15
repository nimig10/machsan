-- ============================================================================
-- Migration 001: Normalize equipment + reservations into relational tables
-- ----------------------------------------------------------------------------
-- SAFETY:
--   * Pure CREATE statements. No DROP, UPDATE, DELETE, or ALTER on `store`.
--   * `store` table and all its JSON data remain fully intact.
--   * All statements use IF NOT EXISTS — safe to re-run.
--   * New tables are populated by app code in a later phase (dual-write).
-- ----------------------------------------------------------------------------
-- Created: 2026-04-15
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

-- ─── EQUIPMENT ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment (
  id                      BIGINT PRIMARY KEY,
  name                    TEXT NOT NULL,
  category                TEXT,
  image                   TEXT,
  notes                   TEXT DEFAULT '',
  description             TEXT DEFAULT '',
  technical_details       TEXT DEFAULT '',
  status                  TEXT DEFAULT 'תקין',
  photo_only              BOOLEAN DEFAULT FALSE,
  sound_only              BOOLEAN DEFAULT FALSE,
  private_loan_unlimited  BOOLEAN DEFAULT FALSE,
  certification_id        BIGINT,
  total_quantity          INTEGER DEFAULT 0,
  available_units         INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_name     ON public.equipment(name);

-- ─── EQUIPMENT UNITS (physical unit instances) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment_units (
  id            TEXT PRIMARY KEY,             -- e.g. "1773430018861_1"
  equipment_id  BIGINT NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'תקין',
  fault         TEXT DEFAULT '',
  repair        TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_units_equipment_id ON public.equipment_units(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_units_status       ON public.equipment_units(status);

-- ─── RESERVATIONS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reservations_new (
  id                      BIGINT PRIMARY KEY,
  email                   TEXT,
  phone                   TEXT,
  student_name            TEXT,
  course                  TEXT,
  status                  TEXT,
  loan_type               TEXT,
  project_name            TEXT,

  borrow_date             DATE,
  borrow_time             TEXT,
  return_date             DATE,
  return_time             TEXT,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  submitted_at            TIMESTAMPTZ,
  returned_at             TIMESTAMPTZ,

  overdue_email_sent      BOOLEAN DEFAULT FALSE,
  overdue_notified        BOOLEAN DEFAULT FALSE,

  sound_day_loan          BOOLEAN DEFAULT FALSE,
  sound_night_loan        BOOLEAN DEFAULT FALSE,

  crew_sound_name         TEXT,
  crew_sound_phone        TEXT,
  crew_photographer_name  TEXT,
  crew_photographer_phone TEXT,

  studio_booking_id       BIGINT,
  lesson_id               BIGINT,
  booking_kind            TEXT,
  lesson_auto             BOOLEAN DEFAULT FALSE,
  lesson_kit_id           BIGINT,

  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- NOTE: table name is `reservations_new` deliberately —
-- allows co-existence with any existing `reservations` table.
-- We rename to `reservations` in migration 005, after data migration verified.

CREATE INDEX IF NOT EXISTS idx_reservations_new_email        ON public.reservations_new(email);
CREATE INDEX IF NOT EXISTS idx_reservations_new_status       ON public.reservations_new(status);
CREATE INDEX IF NOT EXISTS idx_reservations_new_borrow_date  ON public.reservations_new(borrow_date);
CREATE INDEX IF NOT EXISTS idx_reservations_new_return_date  ON public.reservations_new(return_date);

-- ─── RESERVATION ITEMS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reservation_items (
  id              BIGSERIAL PRIMARY KEY,
  reservation_id  BIGINT NOT NULL REFERENCES public.reservations_new(id) ON DELETE CASCADE,
  equipment_id    BIGINT REFERENCES public.equipment(id) ON DELETE SET NULL,
  name            TEXT,                -- name snapshot at reservation time
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_id         TEXT,                -- optional: specific physical unit
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservation_items_reservation ON public.reservation_items(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_items_equipment   ON public.reservation_items(equipment_id);

-- ─── RLS POLICIES ───────────────────────────────────────────────────────────
-- Reads: anon can SELECT (matches current public read access on `store`).
-- Writes: only service role (via /api/store.js or /api/* endpoints).

ALTER TABLE public.equipment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_units    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations_new   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_items  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='equipment' AND policyname='equipment_read_all') THEN
    CREATE POLICY equipment_read_all ON public.equipment FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='equipment_units' AND policyname='equipment_units_read_all') THEN
    CREATE POLICY equipment_units_read_all ON public.equipment_units FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations_new' AND policyname='reservations_new_read_all') THEN
    CREATE POLICY reservations_new_read_all ON public.reservations_new FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservation_items' AND policyname='reservation_items_read_all') THEN
    CREATE POLICY reservation_items_read_all ON public.reservation_items FOR SELECT USING (true);
  END IF;
END $$;

-- ─── VERIFY ─────────────────────────────────────────────────────────────────
-- After running, execute:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('equipment','equipment_units','reservations_new','reservation_items');
-- Expected: 4 rows.
