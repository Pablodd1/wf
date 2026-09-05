-- Forward-only timeout repair for the installed six-brand image-lane RPC.
-- Sparse publication predicates are evaluated only after an index-ordered
-- candidate window has stopped. No source rows, evidence, or indexes mutate.
-- Reuses idx_qnsa_listing_global_image_price_order_20260813.


BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_six_brand_image_lane_page(
  p_brand TEXT DEFAULT NULL,
  p_has_image BOOLEAN DEFAULT true,
  p_after_has_price BOOLEAN DEFAULT NULL,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_listing_type TEXT DEFAULT NULL,
  p_scan_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
SET enable_sort = off
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
  v_scan_limit INTEGER := LEAST(GREATEST(COALESCE(p_scan_limit, 500), 50), 500);
  v_result JSONB;
BEGIN
  IF p_brand IS NOT NULL AND p_brand NOT IN (
    'Rolex', 'Patek Philippe', 'Audemars Piguet',
    'Richard Mille', 'Cartier', 'Zenith'
  ) THEN
    RETURN jsonb_build_object(
      'rows', '[]'::jsonb, 'next_cursor', NULL, 'has_more', false,
      'scanned_count', 0, 'eligible_count', 0, 'image_lane', p_has_image
    );
  END IF;
  IF (p_after_has_price IS NULL) <> (p_after_created_at IS NULL)
    OR (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'The complete keyset cursor is required';
  END IF;

  WITH enabled_brands AS MATERIALIZED (
    SELECT control.canonical_brand, control.enabled_run_key
    FROM public.qnsa_two_brand_release_control AS control
    WHERE control.trading_floor_enabled = true
      AND control.canonical_brand IN (
        'Rolex', 'Patek Philippe', 'Audemars Piguet',
        'Richard Mille', 'Cartier', 'Zenith'
      )
      AND (p_brand IS NULL OR control.canonical_brand = p_brand)
      AND NULLIF(btrim(control.enabled_run_key), '') IS NOT NULL
  ), per_brand_candidates AS MATERIALIZED (
    -- Each branch has concrete run/brand prefixes and exactly matches the
    -- existing image/price/time/id index order. Expensive immutable-lineage
    -- and brand-specific identity joins happen only after this bounded step.
    SELECT candidate.*
    FROM enabled_brands AS enabled
    CROSS JOIN LATERAL (
      SELECT
        l.id,
        l.brand_normalized,
        l.created_at,
        (COALESCE(l.price_usd, l.price_normalized, 0) > 0) AS has_source_price
      FROM staging.listings AS l
      WHERE l.normalization_run_key = enabled.enabled_run_key
        AND l.brand_normalized = enabled.canonical_brand
        AND l.created_at IS NOT NULL
        -- Exact partial-index predicates; all sparse release gates follow LIMIT.
        AND l.parent_id IS NULL
        AND COALESCE(l.is_bundle, false) = false
        AND (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
          ~* '^https?://[^[:space:]]+$') = p_has_image
        AND (
          p_after_has_price IS NULL
          OR (CASE WHEN COALESCE(l.price_usd, l.price_normalized, 0) > 0 THEN 1 ELSE 0 END)
             < (CASE WHEN p_after_has_price THEN 1 ELSE 0 END)
          OR ((COALESCE(l.price_usd, l.price_normalized, 0) > 0) = p_after_has_price
            AND (l.created_at < p_after_created_at
              OR (l.created_at = p_after_created_at AND l.id < p_after_id)))
        )
      ORDER BY
        (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
          ~* '^https?://[^[:space:]]+$') DESC,
        (COALESCE(l.price_usd, l.price_normalized, 0) > 0) DESC,
        l.created_at DESC,
        l.id DESC
      LIMIT v_scan_limit + 1
    ) AS candidate
  ), candidate_window AS MATERIALIZED (
    SELECT merged.*,
      row_number() OVER (
        ORDER BY merged.has_source_price DESC, merged.created_at DESC, merged.id DESC
      )::integer AS candidate_position
    FROM (
      SELECT * FROM per_brand_candidates
      ORDER BY has_source_price DESC, created_at DESC, id DESC
      LIMIT v_scan_limit + 1
    ) AS merged
  ), eligible AS MATERIALIZED (
    SELECT candidate.candidate_position
    FROM candidate_window AS candidate
    JOIN staging.listings AS l ON l.id = candidate.id
    JOIN public.raw_message_versions AS rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    LEFT JOIN staging.qnsa_zenith_identity_reconciliation_audit AS zenith_audit
      ON l.brand_normalized = 'Zenith'
     AND zenith_audit.listing_id = l.id
     AND zenith_audit.normalization_run_key = l.normalization_run_key
     AND zenith_audit.reconciliation_run_key = 'zenith-identity-20260814-v1'
     AND zenith_audit.decision = 'RELEASE_SAFE'
     AND zenith_audit.corrected_reference = l.reference_normalized
    CROSS JOIN LATERAL (
      SELECT regexp_replace(upper(COALESCE(l.reference_normalized, '')),
        '[^A-Z0-9]', '', 'g') AS reference_key
    ) AS normalized
    WHERE candidate.candidate_position <= v_scan_limit
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND (p_listing_type IS NULL
        OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
      AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW')
      AND l.raw_message_version_id IS NOT NULL
      AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND NULLIF(btrim(l.reference_normalized), '') IS NOT NULL
      AND NOT public.reviewed_workbook_reference_is_price_token_v2(
        l.reference_normalized::text,
        l.price_normalized::numeric,
        l.currency_normalized::text
      )
      AND regexp_replace(upper(COALESCE(l.raw_message_text, '')),
        '[^A-Z0-9]', '', 'g') LIKE '%' || normalized.reference_key || '%'
      AND (
        (l.brand_normalized = 'Rolex'
          AND normalized.reference_key ~ '^[0-9]{4,6}[A-Z]{0,4}$')
        OR (l.brand_normalized = 'Patek Philippe'
          AND upper(l.reference_normalized)
            ~ '^[3-8][0-9]{3}[A-Z]?(/[0-9][A-Z0-9]*)?(-[0-9]{3})?$')
        OR (l.brand_normalized = 'Audemars Piguet'
          AND normalized.reference_key ~ '^[0-9]{5}[A-Z0-9]{0,20}$')
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
  ), selected AS MATERIALIZED (
    SELECT candidate.*
    FROM eligible
    JOIN candidate_window AS candidate USING (candidate_position)
    ORDER BY candidate.candidate_position
    LIMIT v_limit
  ), contracted AS MATERIALIZED (
    SELECT selected.candidate_position, selected.has_source_price,
      selected.created_at AS sort_created_at, l.id AS sort_id,
      jsonb_build_object(
        'id', l.id::text,
        'parent_id', NULL,
        'source_file', 'MARIADB_IMMUTABLE_RAW',
        'source_row_number', 1,
        'source_record_id', l.source_record_id,
        'posting_date', l.created_at,
        'seller_name', COALESCE(NULLIF(btrim(l.user_name), ''),
          NULLIF(btrim(l.from_name), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')),
        'seller_phone', CASE WHEN COALESCE(l.contact_consent, false) THEN COALESCE(
          NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) END,
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
          WHEN l.price_usd > 0 AND l.conversion_rate > 0
            AND l.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL
            THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
          WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
          ELSE 'PRICE_NOT_SUPPLIED' END,
        'confidence', l.overall_confidence,
        'verdict', l.verdict,
        'verification_status', l.verdict,
        'user_image_url', CASE WHEN p_has_image
          THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) END,
        'imported_at', l.created_at,
        'has_exact_source_image', p_has_image,
        'verified_price_usd', CASE WHEN l.price_usd > 0 AND (
          l.currency_normalized IN ('USD', 'USDT')
          OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL)
        ) THEN l.price_usd END,
        'has_verified_usd_price', l.price_usd > 0 AND (
          l.currency_normalized IN ('USD', 'USDT')
          OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL)),
        'has_complete_identity', NULLIF(btrim(l.reference_normalized), '') IS NOT NULL,
        'trading_floor_status', l.trading_floor_status,
        'reference_search_key', regexp_replace(upper(COALESCE(
          l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g'),
        'location', COALESCE(NULLIF(btrim(l.location), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')),
        'item_category', 'WATCH',
        'publication_state', CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
          OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
          THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END,
        'publication_lane', 'QNSA_SIX_BRAND_IMAGE_LANE_V1',
        'normalization_run_complete', true,
        'raw_lineage_verified', true,
        'dealer_rating', COALESCE(l.dealer_rating, l.rating,
          CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '')
            ~ '^[0-9]+([.][0-9]+)?$'
          THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END),
        'review_count', CASE WHEN COALESCE(
          rv.raw_payload#>>'{raw_data,review_count}', '') ~ '^[0-9]+$'
          THEN (rv.raw_payload#>>'{raw_data,review_count}')::integer END
      ) AS row_data
    FROM selected
    JOIN staging.listings AS l ON l.id = selected.id
    JOIN public.raw_message_versions AS rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    ORDER BY selected.candidate_position
  ), metrics AS (
    SELECT
      LEAST((SELECT count(*) FROM candidate_window), v_scan_limit)::integer AS scanned_count,
      (SELECT count(*) FROM candidate_window) > v_scan_limit AS candidate_lookahead,
      (SELECT count(*) FROM selected)::integer AS selected_count,
      COALESCE((SELECT max(candidate_position) FROM selected), 0)::integer
        AS selected_last_position
  ), cursor_row AS (
    SELECT candidate.*
    FROM candidate_window AS candidate, metrics
    WHERE candidate.candidate_position = CASE
      WHEN metrics.selected_count = v_limit THEN metrics.selected_last_position
      ELSE metrics.scanned_count END
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(contracted.row_data
      ORDER BY contracted.candidate_position) FROM contracted), '[]'::jsonb),
    'next_cursor', (SELECT jsonb_build_object(
      'has_price', cursor_row.has_source_price,
      'created_at', cursor_row.created_at,
      'id', cursor_row.id
    ) FROM cursor_row),
    'has_more', CASE
      WHEN metrics.selected_count = v_limit THEN
        metrics.selected_last_position < metrics.scanned_count OR metrics.candidate_lookahead
      ELSE metrics.candidate_lookahead END,
    'scanned_count', metrics.scanned_count,
    'eligible_count', metrics.selected_count,
    'image_lane', p_has_image
  ) INTO v_result
  FROM metrics;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_six_brand_image_lane_page(
  TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_six_brand_image_lane_page(
  TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER, TEXT, INTEGER
) TO service_role, postgres, supabase_admin;

COMMENT ON FUNCTION public.qnsa_six_brand_image_lane_page(
  TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER, TEXT, INTEGER
) IS 'Bounded six-brand keyset page. Exhaust true image lane before false lane; exact immutable lineage, explicit singleton, release and brand identity gates are fail closed.';

NOTIFY pgrst, 'reload schema';

COMMIT;
