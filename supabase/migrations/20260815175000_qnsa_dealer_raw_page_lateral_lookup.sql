-- Forward-only plan fence for the bounded global dealer linkage scan.
--
-- The raw UUID page is materialized first. Each member then performs one
-- parameterized lookup through staging.idx_staging_mariadb_raw_version.
-- OFFSET 0 is intentional: it prevents PostgreSQL from flattening/reordering
-- the LATERAL subquery into a full staging scan. No source rows are changed.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_page constant text := $old_page$
  ), raw_page AS MATERIALIZED (
    SELECT id FROM raw_candidates ORDER BY id LIMIT v_limit
  ), eligible AS MATERIALIZED (
    SELECT
      listing.id,
      listing.source_record_id,
      identity.dealer_id,
      public.normalize_seller_phone_identity(
        raw_version.raw_payload#>>'{raw_data,from_number}'
      ) AS matched_phone,
      raw_version.id AS raw_version_id
    FROM raw_page AS page
    JOIN public.raw_message_versions AS raw_version ON raw_version.id = page.id
    JOIN staging.listings AS listing
      ON listing.raw_message_version_id = raw_version.id
     AND raw_version.source_record_id = listing.source_record_id
     AND raw_version.source_hash = listing.source_hash
$old_page$;
  v_new_page constant text := $new_page$
  ), raw_page AS MATERIALIZED (
    SELECT raw_version.id, raw_version.source_record_id, raw_version.source_hash,
      public.normalize_seller_phone_identity(
        raw_version.raw_payload#>>'{raw_data,from_number}'
      ) AS matched_phone
    FROM raw_candidates AS candidate
    JOIN public.raw_message_versions AS raw_version ON raw_version.id = candidate.id
    ORDER BY raw_version.id
    LIMIT v_limit
  ), eligible AS MATERIALIZED (
    SELECT
      listing.id,
      listing.source_record_id,
      identity.dealer_id,
      page.matched_phone,
      page.id AS raw_version_id
    FROM raw_page AS page
    JOIN LATERAL (
      SELECT candidate_listing.*
      FROM staging.listings AS candidate_listing
      WHERE candidate_listing.raw_message_version_id = page.id
        AND candidate_listing.source_record_id = page.source_record_id
        AND candidate_listing.source_hash = page.source_hash
      OFFSET 0
    ) AS listing ON true
$new_page$;
  v_old_identity constant text := $old_identity$
     AND public.normalize_seller_phone_identity(identity.source_identity)
       = public.normalize_seller_phone_identity(
           raw_version.raw_payload#>>'{raw_data,from_number}'
         )
$old_identity$;
  v_new_identity constant text := $new_identity$
     AND public.normalize_seller_phone_identity(identity.source_identity)
       = page.matched_phone
$new_identity$;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_state
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid=index_state.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace ON index_namespace.oid=index_relation.relnamespace
    WHERE index_namespace.nspname='staging'
      AND index_relation.relname='idx_staging_mariadb_raw_version'
      AND index_state.indisvalid AND index_state.indisready
  ) THEN
    RAISE EXCEPTION 'valid staging raw-version lineage index is required';
  END IF;

  SELECT pg_get_functiondef(
    'public.qnsa_dealer_global_raw_phone_link_page(uuid,integer,boolean,integer)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_page IN v_definition) = 0 THEN
    IF position(v_new_page IN v_definition) = 0 THEN
      RAISE EXCEPTION 'global raw linkage page join does not match audited contract';
    END IF;
  ELSE
    v_definition := replace(v_definition, v_old_page, v_new_page);
  END IF;

  IF position(v_old_identity IN v_definition) = 0 THEN
    IF position(v_new_identity IN v_definition) = 0 THEN
      RAISE EXCEPTION 'global raw linkage identity join does not match audited contract';
    END IF;
  ELSE
    v_definition := replace(v_definition, v_old_identity, v_new_identity);
  END IF;

  EXECUTE v_definition;
END
$repair$;

COMMIT;
