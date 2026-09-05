-- Bounded Zenith customer feed over the reconciled, enabled normalization run.
-- All publication gates run before LIMIT/OFFSET.

BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_zenith_candidate_page(
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run_key TEXT;
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
  v_result JSONB;
BEGIN
  SELECT control.enabled_run_key INTO v_run_key
  FROM public.qnsa_two_brand_release_control AS control
  WHERE control.canonical_brand = 'Zenith'
    AND control.trading_floor_enabled = true;

  IF v_run_key IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'next_offset', v_offset,
      'has_more', false, 'scanned_count', 0, 'eligible_count', 0);
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings AS l
    JOIN public.raw_message_versions AS rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    WHERE l.normalization_run_key = v_run_key
      AND l.brand_normalized = 'Zenith'
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND l.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND (p_listing_type IS NULL
        OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
      AND NULLIF(btrim(l.reference_normalized), '') IS NOT NULL
      AND l.raw_message_version_id IS NOT NULL
      AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
      AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW')
    ORDER BY l.reference_normalized ASC, l.id ASC
    LIMIT v_limit + 1 OFFSET v_offset
  ), selected AS MATERIALIZED (
    SELECT id FROM eligible LIMIT v_limit
  ), contracted AS MATERIALIZED (
    SELECT l.reference_normalized AS sort_reference, l.id AS sort_id, jsonb_build_object(
      'id', l.id::text,
      'parent_id', l.parent_id::text,
      'source_file', 'MARIADB_IMMUTABLE_RAW',
      'source_row_number', 1,
      'source_record_id', l.source_record_id,
      'posting_date', l.created_at,
      'seller_name', COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')),
      'seller_phone', COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')),
      'contact_publication_approved', COALESCE(NULLIF(btrim(l.contact_number), ''),
        NULLIF(btrim(l.from_number), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) IS NOT NULL,
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
          THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
        ELSE 'PRICE_NOT_SUPPLIED' END,
      'confidence', l.overall_confidence,
      'verdict', l.verdict,
      'verification_status', l.verdict,
      'user_image_url', CASE
        WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
        THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) END,
      'imported_at', l.created_at,
      'has_exact_source_image', btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$',
      'verified_price_usd', CASE
        WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN l.price_usd
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN l.price_usd
        ELSE NULL END,
      'has_verified_usd_price', l.price_usd > 0 AND (
        l.currency_normalized IN ('USD', 'USDT')
        OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL)),
      'has_complete_identity', NULLIF(btrim(l.reference_normalized), '') IS NOT NULL,
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
      'dealer_rating', COALESCE(l.dealer_rating, l.rating,
        CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END)
    ) AS row_data
    FROM selected s
    JOIN staging.listings l ON l.id = s.id
    JOIN public.raw_message_versions rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    ORDER BY l.reference_normalized ASC, l.id ASC
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(row_data ORDER BY sort_reference, sort_id) FROM contracted), '[]'::jsonb),
    'next_offset', v_offset + LEAST((SELECT count(*) FROM eligible), v_limit),
    'has_more', (SELECT count(*) FROM eligible) > v_limit,
    'scanned_count', (SELECT count(*) FROM eligible),
    'eligible_count', LEAST((SELECT count(*) FROM eligible), v_limit)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_zenith_candidate_page(INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_zenith_candidate_page(INTEGER, INTEGER, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.qnsa_later_brand_candidate_stride_page(
  p_brand TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  SELECT CASE
    WHEN p_brand = 'Zenith' THEN public.qnsa_zenith_candidate_page(
      GREATEST(COALESCE(p_offset, 0), 0),
      LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50),
      p_listing_type)
    ELSE public.qnsa_later_brand_candidate_page(
      p_brand,
      GREATEST(COALESCE(p_offset, 0), 0),
      LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50),
      CASE WHEN p_brand = 'Richard Mille' THEN 4 ELSE 50 END,
      p_listing_type)
  END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
