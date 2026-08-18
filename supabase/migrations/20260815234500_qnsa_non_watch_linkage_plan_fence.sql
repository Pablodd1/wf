-- Forward repair for the non-watch exact linkage contract.
--
-- The first canary never reached its page/apply loop because its preflight
-- reconciliation performed an unbounded staging aggregate. Replace that
-- reconciliation with a small private-ledger reconciliation and fence the page
-- plan so PostgreSQL materializes a raw UUID page before an indexed,
-- parameterized staging lookup. No source or linkage rows are changed here.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_limit constant text := $old_limit$
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$old_limit$;
  v_new_limit constant text := $new_limit$
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$new_limit$;
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
      upper(listing.category) AS category,
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
      upper(listing.category) AS category,
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
    'public.qnsa_non_watch_dealer_link_page(uuid,integer,boolean,integer)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_limit IN v_definition)=0 THEN
    IF position(v_new_limit IN v_definition)=0 THEN
      RAISE EXCEPTION 'non-watch linkage page limit does not match audited contract';
    END IF;
  ELSE
    v_definition := replace(v_definition, v_old_limit, v_new_limit);
  END IF;

  IF position(v_old_page IN v_definition)=0 THEN
    IF position(v_new_page IN v_definition)=0 THEN
      RAISE EXCEPTION 'non-watch linkage page join does not match audited contract';
    END IF;
  ELSE
    v_definition := replace(v_definition, v_old_page, v_new_page);
  END IF;

  IF position(v_old_identity IN v_definition)=0 THEN
    IF position(v_new_identity IN v_definition)=0 THEN
      RAISE EXCEPTION 'non-watch linkage identity join does not match audited contract';
    END IF;
  ELSE
    v_definition := replace(v_definition, v_old_identity, v_new_identity);
  END IF;

  EXECUTE v_definition;
END
$repair$;

CREATE OR REPLACE FUNCTION public.qnsa_non_watch_dealer_linkage_reconciliation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $$
  SELECT jsonb_build_object(
    'applied_non_watch_links', (SELECT count(*)
      FROM public.dealer_listing_links
      WHERE source_system='QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE'
        AND link_status='APPLIED'),
    'linked_non_watch_dealers', (SELECT count(DISTINCT dealer_id)
      FROM public.dealer_listing_links
      WHERE source_system='QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE'
        AND link_status='APPLIED'),
    'duplicate_verified_phones', (SELECT count(*) FROM (
      SELECT public.normalize_seller_phone_identity(source_identity)
      FROM public.dealer_source_identities
      WHERE verification_status='VERIFIED'
        AND upper(identity_type) IN ('PHONE','WHATSAPP')
        AND public.normalize_seller_phone_identity(source_identity) IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT dealer_id)>1
    ) duplicate),
    'orphan_non_watch_links', (SELECT count(*)
      FROM public.dealer_listing_links AS link
      WHERE link.source_system='QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE'
        AND NOT EXISTS (SELECT 1 FROM staging.listings AS listing
          WHERE listing.id=link.listing_id)),
    'non_applied_non_watch_links', (SELECT count(*)
      FROM public.dealer_listing_links
      WHERE source_system='QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE'
        AND link_status<>'APPLIED')
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_non_watch_dealer_linkage_reconciliation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_non_watch_dealer_linkage_reconciliation()
  TO service_role, postgres, supabase_admin;

COMMIT;
