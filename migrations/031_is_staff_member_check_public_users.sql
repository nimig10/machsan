-- 031_is_staff_member_check_public_users.sql
-- Update is_staff_member() to check BOTH auth tables (public.users + staff_members),
-- mirroring the requireStaff() logic in api/_auth-helper.js.
--
-- Why this matters:
--   The original is_staff_member() only checked the legacy staff_members
--   table. After Stage 6 step 7 enabled RLS on the new normalized tables
--   (students/certification_types/tracks/student_certifications), the actual
--   admin (nimig10@gmail.com — present in public.users with is_admin=true
--   but NOT in staff_members) started getting 403s on every write.
--   This brings the DB-side staff check into agreement with the API-side
--   requireStaff() helper which already had the dual-table fallback.

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND (is_admin = true OR is_warehouse = true)
  ) OR EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE staff_members.email = auth.email()
  );
$function$;
