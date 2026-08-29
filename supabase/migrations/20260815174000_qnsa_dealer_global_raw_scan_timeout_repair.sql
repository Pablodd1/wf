-- Forward-only query-plan repair for the global immutable-raw dealer scan.
--
-- A nullable OR in the first-page predicate allowed PostgreSQL to choose a
-- generic sequential plan inside PL/pgSQL. Replace it with one indexable UUID
-- lower bound. A zero UUID cannot be produced by the raw import's gen_random_uuid
-- default; if one were ever inserted explicitly, the unchanged exact snapshot
-- reconciliation would block completion because scanned_count would differ.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_fragment constant text :=
    'WHERE p_after_raw_version_id IS NULL OR raw_version.id > p_after_raw_version_id';
  v_new_fragment constant text :=
    'WHERE raw_version.id > COALESCE('
      || 'p_after_raw_version_id, ''00000000-0000-0000-0000-000000000000''::uuid)';
BEGIN
  SELECT pg_get_functiondef(
    'public.qnsa_dealer_global_raw_phone_link_page(uuid,integer,boolean,integer)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_fragment IN v_definition) = 0 THEN
    IF position(v_new_fragment IN v_definition) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'global raw linkage cursor predicate does not match audited contract';
  END IF;

  EXECUTE replace(v_definition, v_old_fragment, v_new_fragment);
END
$repair$;

COMMIT;
