-- Exact cursor contract for broad Richard Mille / Cartier browsing without a
-- new index. One indexed candidate window is scanned per call; publication
-- gates are applied inside that window and the response explicitly reports the
-- candidate offset consumed and whether a raw candidate lookahead exists.

CREATE OR REPLACE FUNCTION public.qnsa_later_brand_candidate_page(
  p_brand TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50,
  p_scan_limit INTEGER DEFAULT 500,
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
  v_page_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
  v_scan_limit INTEGER := LEAST(GREATEST(COALESCE(p_scan_limit, 500), 50), 500);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_result JSONB;
BEGIN
  IF p_brand NOT IN ('Richard Mille', 'Cartier') THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'next_offset', v_offset, 'has_more', false,
      'scanned_count', 0, 'eligible_count', 0);
  END IF;

  SELECT control.enabled_run_key INTO v_run_key
  FROM public.qnsa_two_brand_release_control AS control
  WHERE control.canonical_brand = p_brand AND control.trading_floor_enabled = true;
  IF v_run_key IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'next_offset', v_offset, 'has_more', false,
      'scanned_count', 0, 'eligible_count', 0);
  END IF;

  WITH candidate_window AS MATERIALIZED (
    SELECT ordered.id, ordered.reference_normalized,
      row_number() OVER (ORDER BY ordered.reference_normalized ASC NULLS LAST, ordered.id ASC)::integer AS candidate_position
    FROM (
      SELECT l.id, l.reference_normalized
      FROM staging.listings AS l
      WHERE l.normalization_run_key = v_run_key
        AND l.brand_normalized = p_brand
        -- Enter the valid reference namespace through the existing
        -- (brand_normalized, reference_normalized) ordering. This replaces the
        -- old Cartier-only +2650 magic offset without scanning or skipping a
        -- potentially changing invalid prefix.
        AND ((p_brand = 'Richard Mille'
              AND l.reference_normalized >= 'RM' AND l.reference_normalized < 'RN')
          OR (p_brand = 'Cartier'
              AND l.reference_normalized >= 'W' AND l.reference_normalized < 'X'))
        AND upper(COALESCE(l.category, '')) = 'WATCH'
        AND l.parent_id IS NULL AND COALESCE(l.is_bundle, false) = false
        AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
        AND (p_listing_type IS NULL
          OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
      ORDER BY l.reference_normalized ASC NULLS LAST, l.id ASC
      LIMIT v_scan_limit + 1 OFFSET v_offset
    ) AS ordered
  ), eligible AS MATERIALIZED (
    SELECT candidate.candidate_position,
      to_jsonb(contract) AS row_data
    FROM candidate_window AS candidate
    JOIN staging.listings AS l ON l.id = candidate.id
    JOIN public.raw_message_versions AS rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    CROSS JOIN LATERAL (
      SELECT regexp_replace(upper(COALESCE(l.reference_normalized, '')), '[^A-Z0-9]', '', 'g') AS reference_key
    ) AS normalized
    CROSS JOIN LATERAL (
      SELECT
        l.id::text AS id, l.parent_id::text AS parent_id,
        'MARIADB_IMMUTABLE_RAW'::text AS source_file, 1 AS source_row_number,
        l.source_record_id, l.created_at AS posting_date,
        COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')) AS seller_name,
        COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) AS seller_phone,
        (COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
          NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) IS NOT NULL) AS contact_publication_approved,
        l.raw_message_text AS raw_message,
        upper(COALESCE(l.listing_type, l.intent, '')) AS listing_type,
        l.brand_normalized AS brand_scope, l.brand_original AS supplied_brand,
        l.brand_normalized AS canonical_brand, l.model_original AS model,
        l.model_normalized AS catalog_model, l.reference_original AS raw_reference,
        l.reference_normalized AS normalized_reference, l.reference_normalized AS catalog_reference,
        l.dial_color_normalized AS dial_color, l.dial_color_normalized AS catalog_dial,
        l.condition_normalized AS condition, l.price_usd AS workbook_price_usd,
        l.price_normalized AS source_price_amount, l.currency_normalized AS source_currency,
        CASE
          WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
          WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
          WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED' ELSE 'PRICE_NOT_SUPPLIED'
        END AS price_evidence_status,
        l.overall_confidence AS confidence, l.verdict, l.verdict AS verification_status,
        CASE WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
          THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) ELSE NULL END AS user_image_url,
        l.created_at AS imported_at,
        (btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
        CASE
          WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN l.price_usd
          WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN l.price_usd
          ELSE NULL
        END AS verified_price_usd,
        (l.price_usd > 0 AND (l.currency_normalized IN ('USD', 'USDT')
          OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) AS has_verified_usd_price,
        (l.reference_normalized IS NOT NULL AND btrim(l.reference_normalized) <> '') AS has_complete_identity,
        l.trading_floor_status,
        regexp_replace(upper(COALESCE(l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
        NULLIF(btrim(l.location), '') AS location, 'WATCH'::text AS item_category,
        CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
          OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
          THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END AS publication_state,
        'QNSA_REVIEWED_LATER_BRAND_CANDIDATE_V1'::text AS publication_lane,
        true AS normalization_run_complete, true AS raw_lineage_verified,
        COALESCE(l.dealer_rating, l.rating,
          CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
            THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric ELSE NULL END) AS dealer_rating
    ) AS contract
    WHERE candidate.candidate_position <= v_scan_limit
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
        'withdrawn', 'rejected', 'hidden', 'deleted', 'archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
      AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW')
      AND ((p_brand = 'Richard Mille' AND normalized.reference_key ~ '^RM[0-9]{3,6}[A-Z]{0,3}$')
        OR (p_brand = 'Cartier' AND normalized.reference_key ~ '^W[A-Z0-9]{5,18}$'
          AND normalized.reference_key ~ '[0-9]'))
  ), selected AS MATERIALIZED (
    SELECT eligible.candidate_position, eligible.row_data
    FROM eligible ORDER BY eligible.candidate_position LIMIT v_page_limit
  ), metrics AS (
    SELECT
      LEAST((SELECT count(*) FROM candidate_window), v_scan_limit)::integer AS scanned_count,
      (SELECT count(*) FROM candidate_window) > v_scan_limit AS candidate_lookahead,
      (SELECT count(*) FROM selected)::integer AS selected_count,
      COALESCE((SELECT max(candidate_position) FROM selected), 0)::integer AS selected_last_position
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(selected.row_data ORDER BY selected.candidate_position) FROM selected), '[]'::jsonb),
    'next_offset', v_offset + CASE
      WHEN metrics.selected_count = v_page_limit THEN metrics.selected_last_position
      ELSE metrics.scanned_count END,
    'has_more', CASE
      WHEN metrics.selected_count = v_page_limit
        THEN metrics.selected_last_position < metrics.scanned_count OR metrics.candidate_lookahead
      ELSE metrics.candidate_lookahead END,
    'scanned_count', metrics.scanned_count,
    'eligible_count', metrics.selected_count
  ) INTO v_result
  FROM metrics;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_page(TEXT, INTEGER, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_page(TEXT, INTEGER, INTEGER, INTEGER, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
