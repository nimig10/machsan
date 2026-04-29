-- Stage 12 Session C — public.categories and public.loan_type_filters are now
-- the source of truth. Reads were flipped in Session B; this migration retires
-- the legacy blobs:
--   1. delete store rows for categories, categoryTypes, and categoryLoanTypes,
--   2. remove those keys from is_protected_store_key (no longer guarded).

DELETE FROM public.store WHERE key IN ('categories', 'categoryTypes', 'categoryLoanTypes');

-- Remove categories and categoryTypes from the shrink-guard allowlist.
-- equipment, students, certifications remain protected.
CREATE OR REPLACE FUNCTION public.is_protected_store_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_key = ANY(ARRAY[
    'equipment',
    'students',
    'certifications'
  ]);
$function$;
