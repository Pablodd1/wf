-- Exact-reference Zenith Trading Floor lane. The generic exact-reference RPC
-- predates Zenith's immutable identity-reconciliation ledger, so it cannot be
-- used as the authority for this brand. Keep punctuation exact and apply the
-- same release gates and ordering as qnsa_zenith_ordered_candidate_page.

BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_zenith_reference_rows(
  p_reference TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 51,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run_key TEXT;
BEGIN
  IF NULLIF(btrim(p_reference), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT enabled_run_key INTO v_run_key
  FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand = 'Zenith' AND trading_floor_enabled = true;

  IF v_run_key IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible AS MATERIALIZED (
    SELECT
      l.id,
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') AS has_image,
      (l.price_usd > 0 AND (
        l.currency_normalized IN ('USD', 'USDT')
        OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL)
      )) AS has_price
    FROM staging.listings AS l
    JOIN staging.qnsa_zenith_identity_reconciliation_audit AS audit
      ON audit.listing_id = l.id
     AND audit.normalization_run_key = l.normalization_run_key
     AND audit.reconciliation_run_key = 'zenith-identity-20260814-v1'
     AND audit.decision = 'RELEASE_SAFE'
     AND audit.corrected_reference = l.reference_normalized
    JOIN public.raw_message_versions AS rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    WHERE l.normalization_run_key = v_run_key
      AND l.brand_normalized = 'Zenith'
      -- Exact punctuation is intentional. Search-key normalization remains a
      -- presentation aid and never broadens this admission predicate.
      AND l.reference_normalized = btrim(p_reference)
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND l.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'
      AND l.provenance_metadata->>'identity_reconciliation_status'
        = 'RELEASE_SAFE_EXACT_SOURCE_REFERENCE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND (p_listing_type IS NULL
        OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW')
    ORDER BY has_image DESC, has_price DESC, l.created_at DESC, l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'id', l.id::text,
    'parent_id', l.parent_id::text,
    'source_file', 'MARIADB_IMMUTABLE_RAW',
    'source_row_number', 1,
    'source_record_id', l.source_record_id,
    'posting_date', l.created_at,
    'seller_name', COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
      NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')),
    'seller_phone', CASE WHEN COALESCE(l.contact_consent, false) THEN
      COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), ''))
      ELSE NULL END,
    'contact_publication_approved', COALESCE(l.contact_consent, false),
    'raw_message', l.raw_message_text,
    'listing_type', upper(COALESCE(l.listing_type, l.intent, '')),
    'brand_scope', l.brand_normalized,
    'supplied_brand', l.brand_original,
    'canonical_brand', l.brand_normalized,
    'model', l.model_original,
    'catalog_model', l.model_normalized,
    'raw_reference', l.reference_original,
    'normalized_reference', l.reference_normalized,
    'catalog_reference', l.reference_normalized,
    'dial_color', l.dial_color_normalized,
    'catalog_dial', l.dial_color_normalized,
    'condition', l.condition_normalized,
    'workbook_price_usd', l.price_usd,
    'source_price_amount', l.price_normalized,
    'source_currency', l.currency_normalized,
    'price_evidence_status', CASE
      WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0
        THEN 'SOURCE_EXPLICIT_USD_MATCH'
      WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
        AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL
        THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
      WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
      ELSE 'PRICE_NOT_SUPPLIED'
    END,
    'confidence', l.overall_confidence,
    'verdict', l.verdict,
    'verification_status', l.verdict,
    'user_image_url', CASE WHEN eligible.has_image
      THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) END,
    'imported_at', l.created_at,
    'has_exact_source_image', eligible.has_image,
    'verified_price_usd', CASE WHEN eligible.has_price THEN l.price_usd END,
    'has_verified_usd_price', eligible.has_price,
    'has_complete_identity', true,
    'trading_floor_status', l.trading_floor_status,
    'reference_search_key', regexp_replace(upper(l.reference_normalized), '[^A-Z0-9]', '', 'g'),
    'location', COALESCE(NULLIF(btrim(l.location), ''),
      NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')),
    'item_category', 'WATCH',
    'publication_state', CASE
      WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
        OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
      THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END,
    'publication_lane', 'QNSA_ZENITH_REVIEWED_V1',
    'normalization_run_complete', true,
    'raw_lineage_verified', true,
    'identity_reconciliation_status', 'RELEASE_SAFE_EXACT_SOURCE_REFERENCE',
    'dealer_rating', COALESCE(l.dealer_rating, l.rating, CASE
      WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
      THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END)
  )
  FROM eligible
  JOIN staging.listings AS l ON l.id = eligible.id
  JOIN public.raw_message_versions AS rv
    ON rv.id = l.raw_message_version_id
   AND rv.source_record_id = l.source_record_id
   AND rv.source_hash = l.source_hash
  ORDER BY eligible.has_image DESC, eligible.has_price DESC, l.created_at DESC, l.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_zenith_reference_rows(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_zenith_reference_rows(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role, postgres, supabase_admin;

NOTIFY pgrst, 'reload schema';

COMMIT;
