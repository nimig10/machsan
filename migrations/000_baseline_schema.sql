-- Migration: 000_baseline_schema
-- Version: 20260101000000 (earliest possible - runs before all others)
--
-- PURPOSE:
--   Supabase Branching replays the migration chain on new branches from an
--   empty DB. Several core tables (store, users, equipment, equipment_units,
--   reservations_new, reservation_items, staff_daily_tasks) were created
--   historically via the Dashboard UI and never tracked as migrations.
--   As a result, the first tracked migration (enable_rls_on_store) fails on
--   any new branch because public.store does not yet exist.
--
--   This baseline creates all of those tables with IF NOT EXISTS so it is a
--   no-op on production (where they already exist) but ensures branches get
--   them before the subsequent migrations run.
--
-- SAFETY:
--   * All CREATE statements use IF NOT EXISTS
--   * No ALTER / DROP anywhere
--   * Idempotent — running twice produces the same result
--
-- STATUS ON PRODUCTION:
--   This migration is recorded as applied on 20260101000000 without the
--   statements actually running (schema already exists). On branches, the
--   full statements execute.

-- ============================================================================
-- 1. store — core JSONB key-value store (target of migration 20260325141902)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.store (
  key text PRIMARY KEY,
  data jsonb,
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_key ON public.store USING btree (key);
CREATE INDEX IF NOT EXISTS idx_store_updated_at ON public.store USING btree (updated_at DESC);

-- ============================================================================
-- 2. users — public.users companion to auth.users
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  is_student boolean NOT NULL DEFAULT false,
  is_lecturer boolean NOT NULL DEFAULT false,
  is_warehouse boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  permissions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  push_subscription jsonb,
  is_push_enabled boolean NOT NULL DEFAULT true
);

-- ============================================================================
-- 3. equipment — catalog of equipment items
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.equipment (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text,
  image text,
  notes text DEFAULT '',
  description text DEFAULT '',
  technical_details text DEFAULT '',
  status text DEFAULT 'תקין',
  photo_only boolean DEFAULT false,
  sound_only boolean DEFAULT false,
  private_loan_unlimited boolean DEFAULT false,
  certification_id text,
  total_quantity integer DEFAULT 0,
  available_units integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.equipment USING btree (category);
CREATE INDEX IF NOT EXISTS idx_equipment_name ON public.equipment USING btree (name);

-- ============================================================================
-- 4. equipment_units — individual numbered instances of each equipment
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.equipment_units (
  id text PRIMARY KEY,
  equipment_id text NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  status text DEFAULT 'תקין',
  fault text DEFAULT '',
  repair text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_units_equipment_id ON public.equipment_units USING btree (equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_units_status ON public.equipment_units USING btree (status);

-- ============================================================================
-- 5. reservations_new — normalized reservations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reservations_new (
  id text PRIMARY KEY,
  email text,
  phone text,
  student_name text,
  course text,
  status text,
  loan_type text,
  project_name text,
  borrow_date date,
  borrow_time text,
  return_date date,
  return_time text,
  created_at timestamptz DEFAULT now(),
  submitted_at timestamptz,
  returned_at timestamptz,
  overdue_email_sent boolean DEFAULT false,
  overdue_notified boolean DEFAULT false,
  sound_day_loan boolean DEFAULT false,
  sound_night_loan boolean DEFAULT false,
  crew_sound_name text,
  crew_sound_phone text,
  crew_photographer_name text,
  crew_photographer_phone text,
  studio_booking_id text,
  lesson_id text,
  booking_kind text,
  lesson_auto boolean DEFAULT false,
  lesson_kit_id text,
  updated_at timestamptz DEFAULT now(),
  overdue_student_note text,
  reminder_sent boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_reservations_new_borrow_date ON public.reservations_new USING btree (borrow_date);
CREATE INDEX IF NOT EXISTS idx_reservations_new_email ON public.reservations_new USING btree (email);
CREATE INDEX IF NOT EXISTS idx_reservations_new_return_date ON public.reservations_new USING btree (return_date);
CREATE INDEX IF NOT EXISTS idx_reservations_new_status ON public.reservations_new USING btree (status);

-- ============================================================================
-- 6. reservation_items — line items per reservation
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reservation_items (
  id bigserial PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES public.reservations_new(id) ON DELETE CASCADE,
  equipment_id text REFERENCES public.equipment(id) ON DELETE SET NULL,
  name text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_id text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservation_items_equipment ON public.reservation_items USING btree (equipment_id);
CREATE INDEX IF NOT EXISTS idx_reservation_items_reservation ON public.reservation_items USING btree (reservation_id);

-- ============================================================================
-- 7. staff_daily_tasks — daily task assignments (open/close/prep)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.staff_daily_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  task_key text NOT NULL CHECK (task_key = ANY (ARRAY['open'::text, 'close'::text, 'prep'::text])),
  staff_id uuid NOT NULL,
  assigned_by uuid,
  locked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (date, task_key)
);
CREATE INDEX IF NOT EXISTS idx_staff_daily_tasks_date ON public.staff_daily_tasks USING btree (date);
