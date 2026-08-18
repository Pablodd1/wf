BEGIN;

-- One customer ordering contract across every QNSA Trading Floor path:
-- exact source image, usable price, newest observation, stable identifier.
-- Bundle parents/children remain excluded by each function's existing gates.

CREATE OR REPLACE FUNCTION public.qnsa_trading_floor_reference_rows(
  p_brand text,
  p_reference text,
  p_family boolean DEFAULT false,
  p_limit integer DEFAULT 51,
  p_offset integer DEFAULT 0
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $function$
DECLARE
  v_run_key text;
BEGIN
  SELECT enabled_run_key INTO v_run_key
  FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand = p_brand AND trading_floor_enabled = true;
  IF v_run_key IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible_ids AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings AS l
    WHERE l.normalization_run_key = v_run_key
      AND l.brand_normalized = p_brand
      AND (CASE WHEN p_family THEN l.reference_normalized LIKE p_reference || '%'
        ELSE l.reference_normalized = p_reference END)
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
    ORDER BY
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') DESC,
      (COALESCE(l.price_usd, l.price_normalized, 0) > 0) DESC,
      l.created_at DESC,
      l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT to_jsonb(row_contract)
  FROM (
    SELECT
      l.id::text AS id,
      l.parent_id::text AS parent_id,
      'MARIADB_IMMUTABLE_RAW'::text AS source_file,
      1 AS source_row_number,
      l.source_record_id,
      l.created_at AS posting_date,
      COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')) AS seller_name,
      COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) AS seller_phone,
      true AS contact_publication_approved,
      l.raw_message_text AS raw_message,
      upper(COALESCE(l.listing_type, l.intent, '')) AS listing_type,
      l.brand_normalized AS brand_scope,
      l.brand_original AS supplied_brand,
      l.brand_normalized AS canonical_brand,
      l.model_original AS model,
      l.model_normalized AS catalog_model,
      l.reference_original AS raw_reference,
      l.reference_normalized AS normalized_reference,
      l.reference_normalized AS catalog_reference,
      l.dial_color_normalized AS dial_color,
      l.dial_color_normalized AS catalog_dial,
      l.condition_normalized AS condition,
      l.price_usd AS workbook_price_usd,
      l.price_normalized AS source_price_amount,
      l.currency_normalized AS source_currency,
      CASE
        WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
        ELSE 'PRICE_NOT_SUPPLIED'
      END AS price_evidence_status,
      l.overall_confidence AS confidence,
      l.verdict,
      l.verdict AS verification_status,
      CASE WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$'
        THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) END AS user_image_url,
      l.created_at AS imported_at,
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
      CASE WHEN l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))
        THEN l.price_usd END AS verified_price_usd,
      (l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) AS has_verified_usd_price,
      true AS has_complete_identity,
      l.trading_floor_status,
      regexp_replace(upper(l.reference_normalized), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      COALESCE(NULLIF(btrim(l.location), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')) AS location,
      'WATCH'::text AS item_category,
      CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
        OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
        THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END AS publication_state,
      'QNSA_ROLEX_PATEK_REVIEWED_V1'::text AS publication_lane,
      true AS normalization_run_complete,
      true AS raw_lineage_verified,
      COALESCE(l.dealer_rating, l.rating,
        CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END) AS dealer_rating
    FROM eligible_ids eligible
    JOIN staging.listings l ON l.id = eligible.id
    JOIN public.raw_message_versions rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    ORDER BY
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') DESC,
      (COALESCE(l.price_usd, l.price_normalized, 0) > 0) DESC,
      l.created_at DESC,
      l.id DESC
  ) row_contract;
END;
$function$;

CREATE OR REPLACE FUNCTION public.qnsa_market_feed_page_rows(
  p_brand text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 51,
  p_offset integer DEFAULT 0,
  p_listing_type text DEFAULT NULL,
  p_images_only boolean DEFAULT false,
  p_location text DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL
)
RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $function$
DECLARE
  v_run_key text;
  v_categories text[];
  v_category text := upper(NULLIF(btrim(p_category), ''));
BEGIN
  SELECT enabled_run_key, enabled_categories INTO v_run_key, v_categories
  FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true;
  IF v_run_key IS NULL THEN RETURN; END IF;
  IF v_category IS NOT NULL AND NOT (v_category = ANY(v_categories)) THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings l
    WHERE l.normalization_run_key = v_run_key
      AND upper(COALESCE(l.category, '')) = ANY(v_categories)
      AND (v_category IS NULL OR upper(COALESCE(l.category, '')) = v_category)
      AND (p_brand IS NULL OR l.brand_normalized = p_brand)
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND (p_listing_type IS NULL
        OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
      AND l.raw_message_version_id IS NOT NULL
      AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (p_posted_after IS NULL OR l.created_at >= p_posted_after)
      AND (p_location IS NULL OR COALESCE(l.location, '') ILIKE '%' || p_location || '%')
      AND (NOT p_images_only OR btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$')
    ORDER BY
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') DESC,
      (COALESCE(l.price_usd, l.price_normalized, 0) > 0) DESC,
      l.created_at DESC,
      l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT to_jsonb(contract)
  FROM (
    SELECT
      l.id::text AS id,
      l.parent_id::text AS parent_id,
      'MARIADB_IMMUTABLE_RAW'::text AS source_file,
      1 AS source_row_number,
      l.source_record_id,
      l.created_at AS posting_date,
      COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')) AS seller_name,
      COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) AS seller_phone,
      true AS contact_publication_approved,
      l.raw_message_text AS raw_message,
      upper(COALESCE(l.listing_type, l.intent, '')) AS listing_type,
      l.brand_normalized AS brand_scope,
      l.brand_original AS supplied_brand,
      l.brand_normalized AS canonical_brand,
      l.model_original AS model,
      l.model_normalized AS catalog_model,
      l.reference_original AS raw_reference,
      l.reference_normalized AS normalized_reference,
      l.reference_normalized AS catalog_reference,
      l.dial_color_normalized AS dial_color,
      l.dial_color_normalized AS catalog_dial,
      l.condition_normalized AS condition,
      l.price_usd AS workbook_price_usd,
      l.price_normalized AS source_price_amount,
      l.currency_normalized AS source_currency,
      CASE
        WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
        ELSE 'PRICE_NOT_SUPPLIED'
      END AS price_evidence_status,
      l.overall_confidence AS confidence,
      l.verdict,
      l.verdict AS verification_status,
      CASE WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$'
        THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) ELSE NULL END AS user_image_url,
      l.created_at AS imported_at,
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
      CASE WHEN l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))
        THEN l.price_usd ELSE NULL END AS verified_price_usd,
      (l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) AS has_verified_usd_price,
      (COALESCE(l.reference_normalized, l.model_normalized, l.model_original) IS NOT NULL) AS has_complete_identity,
      l.trading_floor_status,
      regexp_replace(upper(COALESCE(l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      NULLIF(btrim(l.location), '') AS location,
      upper(l.category)::text AS item_category,
      CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
        OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
        THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END AS publication_state,
      'QNSA_GENERAL_MARKET_FEED_V1'::text AS publication_lane,
      true AS normalization_run_complete,
      true AS raw_lineage_verified,
      COALESCE(l.dealer_rating, l.rating,
        CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric ELSE NULL END) AS dealer_rating,
      CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,review_count}', '') ~ '^[0-9]+$'
        THEN (rv.raw_payload#>>'{raw_data,review_count}')::integer ELSE NULL END AS review_count
    FROM eligible e
    JOIN staging.listings l ON l.id = e.id
    JOIN public.raw_message_versions rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    ORDER BY
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, ''))
        ~* '^https?://[^[:space:]]+$') DESC,
      (COALESCE(l.price_usd, l.price_normalized, 0) > 0) DESC,
      l.created_at DESC,
      l.id DESC
  ) contract;
END;
$function$;

-- The ordered scans are bounded by brand/run/reference and never broaden the
-- public release set. These indexes support the exact expressions above.
CREATE INDEX IF NOT EXISTS idx_qnsa_listing_global_image_price_order_20260813
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    ((btrim(COALESCE(image_url, source_media_url_candidate, ''))
      ~* '^https?://[^[:space:]]+$')) DESC,
    ((COALESCE(price_usd, price_normalized, 0) > 0)) DESC,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL AND COALESCE(is_bundle, false) = false;

CREATE INDEX IF NOT EXISTS idx_qnsa_listing_reference_image_price_order_20260813
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized text_pattern_ops,
    ((btrim(COALESCE(image_url, source_media_url_candidate, ''))
      ~* '^https?://[^[:space:]]+$')) DESC,
    ((COALESCE(price_usd, price_normalized, 0) > 0)) DESC,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH';

REVOKE ALL ON FUNCTION public.qnsa_trading_floor_reference_rows(text,text,boolean,integer,integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qnsa_trading_floor_reference_rows(text,text,boolean,integer,integer)
  TO anon, authenticated, service_role, postgres, supabase_admin;
REVOKE ALL ON FUNCTION public.qnsa_market_feed_page_rows(text,text,integer,integer,text,boolean,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_market_feed_page_rows(text,text,integer,integer,text,boolean,text,timestamptz)
  TO service_role, postgres;

COMMENT ON FUNCTION public.qnsa_market_feed_page_rows(text,text,integer,integer,text,boolean,text,timestamptz)
  IS 'Stable Trading Floor page: exact source image, usable price, created_at, id; bundle-safe.';

NOTIFY pgrst, 'reload schema';
COMMIT;
