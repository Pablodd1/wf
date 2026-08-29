-- Forward-only repair for PostgreSQL installations without max(uuid).
-- Rewrites only the installed function definition; no data rows are touched.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_fragment constant text := '(SELECT max(id) FROM candidate_page)';
  v_new_fragment constant text := '(SELECT max(id::text)::uuid FROM candidate_page)';
BEGIN
  SELECT pg_get_functiondef(
    'public.qnsa_dealer_exact_phone_link_page(uuid,uuid,integer,boolean)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_fragment IN v_definition) = 0 THEN
    IF position(v_new_fragment IN v_definition) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'dealer linkage cursor expression does not match audited contract';
  END IF;

  EXECUTE replace(v_definition, v_old_fragment, v_new_fragment);
END
$repair$;

COMMIT;
