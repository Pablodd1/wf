-- Permit the pinned Supabase Management API roles to execute the same bounded
-- read-only customer cursor used by the service-role application.

BEGIN;

GRANT EXECUTE ON FUNCTION public.qnsa_zenith_candidate_page(INTEGER, INTEGER, TEXT)
  TO postgres, supabase_admin;

COMMIT;
