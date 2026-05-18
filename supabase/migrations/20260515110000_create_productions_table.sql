-- Productions board (לוח הפקות) — Session 1/N: parent `productions` table.
--
-- Background: students currently submit production equipment loans via PublicForm
-- (loan_type='הפקה') and must lock dates + crew + equipment list up-front. Real
-- workflow needs a planning artifact that exists BEFORE equipment loan, so directors
-- can publish dates and assemble a crew, then later open the equipment-loan flow
-- pre-filled. This migration is purely additive — no existing flow changes.
--
-- Owner boundary: director_email (denormalized lowercased copy of students.email)
-- is the RLS identity. The auth user's JWT email is matched to this column.

CREATE TABLE IF NOT EXISTS public.productions (
  id                  text PRIMARY KEY,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT ''
                        CHECK (char_length(description) <= 800),
  director_student_id text NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  director_email      text NOT NULL,
  director_name       text NOT NULL,
  director_phone      text,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','cancelled')),
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS productions_director_email_idx
  ON public.productions (lower(director_email));

CREATE INDEX IF NOT EXISTS productions_status_idx
  ON public.productions (status);

CREATE INDEX IF NOT EXISTS productions_status_published_at_idx
  ON public.productions (status, published_at DESC)
  WHERE status = 'published';

DROP TRIGGER IF EXISTS productions_touch_updated_at ON public.productions;
CREATE TRIGGER productions_touch_updated_at
  BEFORE UPDATE ON public.productions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.productions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS productions_service_role_all ON public.productions;
CREATE POLICY productions_service_role_all
  ON public.productions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS productions_staff_all ON public.productions;
CREATE POLICY productions_staff_all
  ON public.productions
  FOR ALL
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

-- Anyone (anon + authenticated) can read published productions.
DROP POLICY IF EXISTS productions_public_read_published ON public.productions;
CREATE POLICY productions_public_read_published
  ON public.productions
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

-- Director (matched by JWT email) can read all their own rows including drafts.
DROP POLICY IF EXISTS productions_director_read_own ON public.productions;
CREATE POLICY productions_director_read_own
  ON public.productions
  FOR SELECT TO authenticated
  USING (lower(director_email) = lower(auth.jwt() ->> 'email'));

-- Director can insert their own production rows.
DROP POLICY IF EXISTS productions_director_insert ON public.productions;
CREATE POLICY productions_director_insert
  ON public.productions
  FOR INSERT TO authenticated
  WITH CHECK (lower(director_email) = lower(auth.jwt() ->> 'email'));

-- Director can update their own rows (only as long as director_email stays equal).
DROP POLICY IF EXISTS productions_director_update ON public.productions;
CREATE POLICY productions_director_update
  ON public.productions
  FOR UPDATE TO authenticated
  USING (lower(director_email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(director_email) = lower(auth.jwt() ->> 'email'));

-- Hard delete is only performed via SECURITY DEFINER RPC `production_delete_v1`
-- (added in a later migration) so reservations can be cancelled atomically and
-- emails fire. Direct DELETE from authenticated is denied (no policy).

ALTER PUBLICATION supabase_realtime ADD TABLE public.productions;
