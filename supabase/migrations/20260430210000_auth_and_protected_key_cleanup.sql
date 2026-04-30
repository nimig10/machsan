-- 1) Add nimig10@gmail.com (auth UID edd4ded8-246c-4cda-a3c9-db0dde72dc18)
--    to public.users so resolveUserRole() returns "staff" instead of "user".
INSERT INTO public.users (id, email, full_name, is_admin, is_warehouse)
VALUES (
  'edd4ded8-246c-4cda-a3c9-db0dde72dc18',
  'nimig10@gmail.com',
  'Admin',
  true,
  true
)
ON CONFLICT (id) DO UPDATE
  SET is_admin    = true,
      is_warehouse = true,
      email       = EXCLUDED.email;

-- 2) Update is_protected_store_key — all blobs have been migrated to tables.
--    The store no longer holds any production data, so there are no keys to protect.
--    The shrink_guard trigger stays in place (it's safe) but will never fire.
CREATE OR REPLACE FUNCTION public.is_protected_store_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT false;
$$;
