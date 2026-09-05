-- Forward-only dealer linkage repair using only existing production indexes.
--
-- Normalized staging intentionally carries no phone fields. This service-only
-- RPC keyset-scans immutable raw versions through their UUID primary key,
-- matches every verified unique dealer phone, and rejoins staging through the
-- existing raw_message_version_id lineage index. It never returns contact data
-- and never changes immutable raw or normalized staging rows.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.qnsa_dealer_global_raw_phone_link_page(
  p_after_raw_version_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_apply boolean DEFAULT false,
  p_apply_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
  v_apply_limit integer := CASE WHEN p_apply_limit IS NULL THEN 2147483647
    ELSE LEAST(GREATEST(p_apply_limit, 0), 10) END;
  v_scanned integer := 0;
  v_eligible integer := 0;
  v_applied integer := 0;
  v_already_linked integer := 0;
  v_conflicting integer := 0;
  v_dealers_matched integer := 0;
  v_next_raw_version_id uuid;
  v_has_more boolean := false;
  v_listing_ids uuid[] := ARRAY[]::uuid[];
  v_source_record_ids text[] := ARRAY[]::text[];
  v_dealer_ids uuid[] := ARRAY[]::uuid[];
  v_matched_phones text[] := ARRAY[]::text[];
BEGIN
  IF p_apply AND p_apply_limit IS NOT NULL AND p_apply_limit NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'bounded apply limit must be between zero and ten';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dealer_source_identities AS identity
    WHERE identity.verification_status = 'VERIFIED'
      AND upper(identity.identity_type) IN ('PHONE', 'WHATSAPP')
      AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
    GROUP BY public.normalize_seller_phone_identity(identity.source_identity)
    HAVING count(DISTINCT identity.dealer_id) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate verified phone identity exists';
  END IF;

  WITH raw_candidates AS MATERIALIZED (
    SELECT raw_version.id
    FROM public.raw_message_versions AS raw_version
    WHERE p_after_raw_version_id IS NULL OR raw_version.id > p_after_raw_version_id
    ORDER BY raw_version.id
    LIMIT v_limit + 1
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
    JOIN public.dealer_source_identities AS identity
      ON identity.verification_status = 'VERIFIED'
     AND upper(identity.identity_type) IN ('PHONE', 'WHATSAPP')
     AND public.normalize_seller_phone_identity(identity.source_identity)
       = public.normalize_seller_phone_identity(
           raw_version.raw_payload#>>'{raw_data,from_number}'
         )
    JOIN public.dealers AS dealer
      ON dealer.id = identity.dealer_id
     AND dealer.status = 'VERIFIED'
    JOIN public.qnsa_two_brand_release_control AS release_control
      ON release_control.canonical_brand = listing.brand_normalized
     AND release_control.enabled_run_key = listing.normalization_run_key
     AND release_control.trading_floor_enabled = true
    JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
      ON checkpoint.run_key = listing.normalization_run_key
     AND checkpoint.status = 'NORMALIZATION_STAGED'
     AND checkpoint.error_rows = 0
    LEFT JOIN staging.qnsa_zenith_identity_reconciliation_audit AS zenith_audit
      ON listing.brand_normalized = 'Zenith'
     AND zenith_audit.listing_id = listing.id
     AND zenith_audit.normalization_run_key = listing.normalization_run_key
     AND zenith_audit.reconciliation_run_key = 'zenith-identity-20260814-v1'
     AND zenith_audit.decision = 'RELEASE_SAFE'
     AND zenith_audit.corrected_reference = listing.reference_normalized
    CROSS JOIN LATERAL (
      SELECT regexp_replace(upper(COALESCE(listing.reference_normalized, '')),
        '[^A-Z0-9]', '', 'g') AS reference_key
    ) AS normalized
    WHERE upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.brand_normalized IN (
        'Rolex', 'Patek Philippe', 'Audemars Piguet',
        'Richard Mille', 'Cartier', 'Zenith'
      )
      AND listing.parent_id IS NULL
      AND COALESCE(listing.is_bundle, false) = false
      AND (
        (listing.brand_normalized IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
          AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE')
            = 'SINGLE_CANDIDATE')
        OR (listing.brand_normalized IN ('Richard Mille', 'Cartier', 'Zenith')
          AND listing.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE')
      )
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) IN ('WTS', 'WTB')
      AND COALESCE(listing.source_record_id, '') <> ''
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND listing.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived'
      )
      AND upper(COALESCE(listing.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'
      )
      AND lower(COALESCE(listing.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(listing.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
      )
      AND (
        listing.brand_normalized NOT IN ('Richard Mille', 'Cartier', 'Zenith')
        OR (listing.brand_normalized = 'Richard Mille'
          AND normalized.reference_key ~ '^RM[0-9]{3,6}[A-Z]{0,3}$')
        OR (listing.brand_normalized = 'Cartier'
          AND normalized.reference_key ~ '^W[A-Z0-9]{5,18}$'
          AND normalized.reference_key ~ '[0-9]')
        OR (listing.brand_normalized = 'Zenith'
          AND zenith_audit.listing_id IS NOT NULL
          AND listing.provenance_metadata->>'identity_reconciliation_status'
            = 'RELEASE_SAFE_EXACT_SOURCE_REFERENCE')
      )
  )
  SELECT
    COALESCE(array_agg(eligible.id ORDER BY eligible.raw_version_id, eligible.id), ARRAY[]::uuid[]),
    COALESCE(array_agg(eligible.source_record_id ORDER BY eligible.raw_version_id, eligible.id), ARRAY[]::text[]),
    COALESCE(array_agg(eligible.dealer_id ORDER BY eligible.raw_version_id, eligible.id), ARRAY[]::uuid[]),
    COALESCE(array_agg(eligible.matched_phone ORDER BY eligible.raw_version_id, eligible.id), ARRAY[]::text[]),
    (SELECT count(*) FROM raw_page),
    (SELECT max(id::text)::uuid FROM raw_page),
    (SELECT count(*) > v_limit FROM raw_candidates),
    count(DISTINCT eligible.dealer_id)
  INTO v_listing_ids, v_source_record_ids, v_dealer_ids, v_matched_phones,
    v_scanned, v_next_raw_version_id, v_has_more, v_dealers_matched
  FROM eligible;

  v_eligible := COALESCE(cardinality(v_listing_ids), 0);
  SELECT
    count(*) FILTER (WHERE link.dealer_id = candidate.dealer_id
      AND link.link_status = 'APPLIED'),
    count(*) FILTER (WHERE link.dealer_id IS NOT NULL
      AND (link.dealer_id <> candidate.dealer_id OR link.link_status <> 'APPLIED'))
  INTO v_already_linked, v_conflicting
  FROM unnest(v_listing_ids, v_dealer_ids) AS candidate(listing_id, dealer_id)
  LEFT JOIN public.dealer_listing_links AS link ON link.listing_id = candidate.listing_id;

  IF v_conflicting <> 0 THEN
    RAISE EXCEPTION 'conflicting dealer/listing link detected';
  END IF;

  IF p_apply AND v_apply_limit > 0 THEN
    INSERT INTO public.dealer_listing_links (
      listing_id, source_record_id, dealer_id, source_system, source_identity,
      link_method, link_status, evidence, updated_at
    )
    SELECT candidate.listing_id, candidate.source_record_id, candidate.dealer_id,
      'QNSA_RELEASE_GATED_RAW_LINEAGE', candidate.matched_phone,
      'EXACT_VERIFIED_PHONE', 'APPLIED',
      jsonb_build_object(
        'release_gate', 'QNSA_SIX_BRAND_EXACT_V1',
        'immutable_lineage_verified', true,
        'contact_value_private', true
      ), now()
    FROM unnest(v_listing_ids, v_source_record_ids, v_dealer_ids, v_matched_phones)
      WITH ORDINALITY AS candidate(
        listing_id, source_record_id, dealer_id, matched_phone, ordinal
      )
    LEFT JOIN public.dealer_listing_links AS existing
      ON existing.listing_id = candidate.listing_id
    WHERE existing.listing_id IS NULL
    ORDER BY candidate.ordinal
    LIMIT v_apply_limit
    ON CONFLICT (listing_id) DO NOTHING;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'eligible', v_eligible,
    'applied', v_applied,
    'already_linked', v_already_linked,
    'conflicting_links', v_conflicting,
    'dealers_matched', v_dealers_matched,
    'next_raw_version_id', COALESCE(v_next_raw_version_id, p_after_raw_version_id),
    'has_more', v_has_more,
    'apply_requested', p_apply,
    'status', 'OK'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_dealer_global_raw_phone_link_page(uuid,integer,boolean,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_dealer_global_raw_phone_link_page(uuid,integer,boolean,integer)
  TO service_role, postgres, supabase_admin;

COMMIT;
