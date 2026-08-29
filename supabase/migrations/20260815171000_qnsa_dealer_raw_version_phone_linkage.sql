-- Forward-only repair: normalized staging intentionally omits seller phones.
-- Candidate discovery therefore starts at immutable raw-message lineage and
-- rejoins staging through raw_message_version_id. Completion semantics and all
-- downstream release gates remain unchanged.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_fragment constant text := $old$
    SELECT l.id, public.normalize_seller_phone_identity(l.contact_number) AS matched_phone
    FROM staging.listings AS l
    WHERE l.contact_number = ANY (
      v_phones || ARRAY(SELECT '+' || phone FROM unnest(v_phones) AS item(phone))
    )
      AND (p_after_id IS NULL OR l.id > p_after_id)
    ORDER BY l.id
    LIMIT v_limit + 1
$old$;
  v_new_fragment constant text := $new$
    SELECT l.id,
      public.normalize_seller_phone_identity(
        raw_version.raw_payload#>>'{raw_data,from_number}'
      ) AS matched_phone
    FROM public.raw_message_versions AS raw_version
    JOIN staging.listings AS l
      ON l.raw_message_version_id = raw_version.id
    WHERE public.normalize_seller_phone_identity(
        raw_version.raw_payload#>>'{raw_data,from_number}'
      ) = ANY (v_phones)
      AND (p_after_id IS NULL OR l.id > p_after_id)
    ORDER BY l.id
    LIMIT v_limit + 1
$new$;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_state
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_state.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = 'idx_qnsa_raw_versions_from_phone'
      AND index_state.indisvalid
      AND index_state.indisready
  ) THEN
    RAISE EXCEPTION 'valid raw-version phone lookup index is required';
  END IF;

  SELECT pg_get_functiondef(
    'public.qnsa_dealer_exact_phone_link_page(uuid,uuid,integer,boolean)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_fragment IN v_definition) = 0 THEN
    IF position(v_new_fragment IN v_definition) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'dealer linkage candidate query does not match audited contract';
  END IF;

  EXECUTE replace(v_definition, v_old_fragment, v_new_fragment);
END
$repair$;

COMMIT;
