-- Forward-only, storage-neutral dealer/listing linkage.
--
-- This replaces the timed-out public-view/bucket scans with a bounded page
-- selected through the existing staging.listings(contact_number) index.  A
-- candidate is linked only after the same release-control, immutable-lineage,
-- singleton, status, and brand-specific identity gates used by the six-brand
-- Trading Floor.  No contact value is returned or copied into public output.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.qnsa_dealer_exact_phone_link_page(
  p_dealer_id uuid,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $$
DECLARE
  v_phones text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_scanned integer := 0;
  v_eligible integer := 0;
  v_applied integer := 0;
  v_already_linked integer := 0;
  v_conflicting integer := 0;
  v_next_id uuid;
  v_has_more boolean := false;
  v_eligible_ids uuid[] := ARRAY[]::uuid[];
  v_source_record_ids text[] := ARRAY[]::text[];
  v_matched_phones text[] := ARRAY[]::text[];
BEGIN
  IF p_dealer_id IS NULL THEN RAISE EXCEPTION 'dealer id is required'; END IF;

  -- A phone can never identify two dealers. Fail before considering listings,
  -- even if a future import bypasses the existing partial unique index.
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

  SELECT array_agg(DISTINCT public.normalize_seller_phone_identity(identity.source_identity))
  INTO v_phones
  FROM public.dealer_source_identities AS identity
  WHERE identity.dealer_id = p_dealer_id
    AND identity.verification_status = 'VERIFIED'
    AND upper(identity.identity_type) IN ('PHONE', 'WHATSAPP')
    AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL;

  IF COALESCE(cardinality(v_phones), 0) = 0 THEN
    RETURN jsonb_build_object(
      'dealer_id', p_dealer_id, 'scanned', 0, 'eligible', 0, 'applied', 0,
      'next_id', p_after_id, 'has_more', false, 'apply_requested', p_apply,
      'status', 'NO_VERIFIED_PHONE'
    );
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT l.id, public.normalize_seller_phone_identity(l.contact_number) AS matched_phone
    FROM staging.listings AS l
    WHERE l.contact_number = ANY (
      v_phones || ARRAY(SELECT '+' || phone FROM unnest(v_phones) AS item(phone))
    )
      AND (p_after_id IS NULL OR l.id > p_after_id)
    ORDER BY l.id
    LIMIT v_limit + 1
  ), candidate_page AS MATERIALIZED (
    SELECT id, matched_phone FROM candidates ORDER BY id LIMIT v_limit
  ), eligible AS MATERIALIZED (
    SELECT l.id, l.source_record_id, candidate.matched_phone
    FROM candidate_page AS candidate
    JOIN staging.listings AS l ON l.id = candidate.id
    JOIN public.raw_message_versions AS raw_version
      ON raw_version.id = l.raw_message_version_id
     AND raw_version.source_record_id = l.source_record_id
     AND raw_version.source_hash = l.source_hash
    JOIN public.qnsa_two_brand_release_control AS release_control
      ON release_control.canonical_brand = l.brand_normalized
     AND release_control.enabled_run_key = l.normalization_run_key
     AND release_control.trading_floor_enabled = true
    JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
      ON checkpoint.run_key = l.normalization_run_key
     AND checkpoint.status = 'NORMALIZATION_STAGED'
     AND checkpoint.error_rows = 0
    LEFT JOIN staging.qnsa_zenith_identity_reconciliation_audit AS zenith_audit
      ON l.brand_normalized = 'Zenith'
     AND zenith_audit.listing_id = l.id
     AND zenith_audit.normalization_run_key = l.normalization_run_key
     AND zenith_audit.reconciliation_run_key = 'zenith-identity-20260814-v1'
     AND zenith_audit.decision = 'RELEASE_SAFE'
     AND zenith_audit.corrected_reference = l.reference_normalized
    CROSS JOIN LATERAL (
      SELECT regexp_replace(upper(COALESCE(l.reference_normalized, '')), '[^A-Z0-9]', '', 'g') AS reference_key
    ) AS normalized
    WHERE upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.brand_normalized IN (
        'Rolex', 'Patek Philippe', 'Audemars Piguet',
        'Richard Mille', 'Cartier', 'Zenith'
      )
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND l.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived'
      )
      AND upper(COALESCE(l.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'
      )
      AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
      )
      AND (
        l.brand_normalized NOT IN ('Richard Mille', 'Cartier', 'Zenith')
        OR (l.brand_normalized = 'Richard Mille'
          AND normalized.reference_key ~ '^RM[0-9]{3,6}[A-Z]{0,3}$')
        OR (l.brand_normalized = 'Cartier'
          AND normalized.reference_key ~ '^W[A-Z0-9]{5,18}$'
          AND normalized.reference_key ~ '[0-9]')
        OR (l.brand_normalized = 'Zenith'
          AND zenith_audit.listing_id IS NOT NULL
          AND l.provenance_metadata->>'identity_reconciliation_status'
            = 'RELEASE_SAFE_EXACT_SOURCE_REFERENCE')
      )
  )
  SELECT
    COALESCE(array_agg(eligible.id ORDER BY eligible.id), ARRAY[]::uuid[]),
    COALESCE(array_agg(eligible.source_record_id ORDER BY eligible.id), ARRAY[]::text[]),
    COALESCE(array_agg(eligible.matched_phone ORDER BY eligible.id), ARRAY[]::text[]),
    (SELECT count(*) FROM candidate_page),
    (SELECT max(id) FROM candidate_page),
    (SELECT count(*) > v_limit FROM candidates)
  INTO v_eligible_ids, v_source_record_ids, v_matched_phones,
    v_scanned, v_next_id, v_has_more
  FROM eligible;

  v_eligible := COALESCE(cardinality(v_eligible_ids), 0);
  SELECT
    count(*) FILTER (WHERE link.dealer_id = p_dealer_id AND link.link_status = 'APPLIED'),
    count(*) FILTER (WHERE link.dealer_id IS NOT NULL
      AND (link.dealer_id <> p_dealer_id OR link.link_status <> 'APPLIED'))
  INTO v_already_linked, v_conflicting
  FROM unnest(v_eligible_ids) AS eligible_id(id)
  LEFT JOIN public.dealer_listing_links AS link ON link.listing_id = eligible_id.id;

  IF p_apply THEN
    INSERT INTO public.dealer_listing_links (
      listing_id, source_record_id, dealer_id, source_system, source_identity,
      link_method, link_status, evidence, updated_at
    )
    SELECT eligible.id, eligible.source_record_id, p_dealer_id,
      'QNSA_RELEASE_GATED_STAGING', eligible.matched_phone,
      'EXACT_VERIFIED_PHONE', 'APPLIED',
      jsonb_build_object(
        'release_gate', 'QNSA_SIX_BRAND_EXACT_V1',
        'immutable_lineage_verified', true,
        'contact_value_private', true
      ), now()
    FROM unnest(v_eligible_ids, v_source_record_ids, v_matched_phones)
      AS eligible(id, source_record_id, matched_phone)
    -- Never silently reassign a listing. A conflicting prior link requires
    -- explicit review and remains visible in reconciliation as a mismatch.
    ON CONFLICT (listing_id) DO NOTHING;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'dealer_id', p_dealer_id,
    'scanned', v_scanned,
    'eligible', v_eligible,
    'applied', v_applied,
    'already_linked', v_already_linked,
    'conflicting_links', v_conflicting,
    'next_id', COALESCE(v_next_id, p_after_id),
    'has_more', v_has_more,
    'apply_requested', p_apply,
    'status', 'OK'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.qnsa_dealer_linkage_reconciliation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $$
  SELECT jsonb_build_object(
    'verified_dealers', (SELECT count(*) FROM public.dealers WHERE status = 'VERIFIED'),
    'dealers_with_verified_phone', (SELECT count(DISTINCT dealer_id)
      FROM public.dealer_source_identities
      WHERE verification_status = 'VERIFIED'
        AND upper(identity_type) IN ('PHONE', 'WHATSAPP')
        AND public.normalize_seller_phone_identity(source_identity) IS NOT NULL),
    'applied_links', (SELECT count(*) FROM public.dealer_listing_links WHERE link_status = 'APPLIED'),
    'linked_dealers', (SELECT count(DISTINCT dealer_id) FROM public.dealer_listing_links
      WHERE link_status = 'APPLIED'),
    'duplicate_verified_phones', (SELECT count(*) FROM (
      SELECT public.normalize_seller_phone_identity(source_identity)
      FROM public.dealer_source_identities
      WHERE verification_status = 'VERIFIED'
        AND upper(identity_type) IN ('PHONE', 'WHATSAPP')
        AND public.normalize_seller_phone_identity(source_identity) IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT dealer_id) > 1
    ) AS duplicates),
    'orphan_links', (SELECT count(*) FROM public.dealer_listing_links AS link
      LEFT JOIN staging.listings AS listing ON listing.id = link.listing_id
      WHERE listing.id IS NULL),
    'non_applied_links', (SELECT count(*) FROM public.dealer_listing_links
      WHERE link_status <> 'APPLIED')
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_dealer_exact_phone_link_page(uuid,uuid,integer,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qnsa_dealer_linkage_reconciliation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_dealer_exact_phone_link_page(uuid,uuid,integer,boolean)
  TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.qnsa_dealer_linkage_reconciliation()
  TO service_role, postgres, supabase_admin;

COMMIT;
