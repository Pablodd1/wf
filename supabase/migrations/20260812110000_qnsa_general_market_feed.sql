-- General customer market feed over the reconciled MariaDB staging run.
-- This does not copy listing payloads. It exposes bounded pages from the
-- existing single-item staging rows and keeps Price Research on its stricter
-- evidence view.

CREATE TABLE IF NOT EXISTS public.qnsa_market_feed_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_run_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  enabled_categories text[] NOT NULL DEFAULT ARRAY['WATCH','HANDBAG','JEWELRY','ACCESSORY']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT current_user
);

INSERT INTO public.qnsa_market_feed_control(singleton, enabled_run_key, enabled)
SELECT true, min(enabled_run_key), true
FROM public.qnsa_two_brand_release_control
WHERE trading_floor_enabled = true
HAVING count(DISTINCT enabled_run_key) = 1
ON CONFLICT (singleton) DO UPDATE
SET enabled_run_key = EXCLUDED.enabled_run_key,
    enabled = EXCLUDED.enabled,
    updated_at = now(),
    updated_by = current_user;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_market_feed_page
ON staging.listings (
  normalization_run_key,
  category,
  created_at DESC,
  id DESC
)
WHERE parent_id IS NULL
  AND COALESCE(is_bundle, false) = false
  AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_market_feed_brand_page
ON staging.listings (
  normalization_run_key,
  brand_normalized,
  created_at DESC,
  id DESC
)
WHERE parent_id IS NULL
  AND COALESCE(is_bundle, false) = false
  AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE OR REPLACE FUNCTION public.qnsa_market_feed_counts()
RETURNS TABLE(category text, brand text, listing_type text, supplied_price boolean, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  WITH control AS (
    SELECT enabled_run_key, enabled_categories
    FROM public.qnsa_market_feed_control
    WHERE singleton = true AND enabled = true
  )
  SELECT
    upper(l.category)::text,
    COALESCE(NULLIF(btrim(l.brand_normalized), ''), 'Unspecified')::text,
    upper(COALESCE(l.listing_type, l.intent, ''))::text,
    (COALESCE(l.price_usd, l.price_normalized, 0) > 0),
    count(*)
  FROM control c
  JOIN staging.listings l ON l.normalization_run_key = c.enabled_run_key
  WHERE upper(COALESCE(l.category, '')) = ANY(c.enabled_categories)
    AND l.parent_id IS NULL
    AND COALESCE(l.is_bundle, false) = false
    AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
    AND l.raw_message_version_id IS NOT NULL
    AND COALESCE(l.source_record_id, '') <> ''
    AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  GROUP BY 1,2,3,4;
$$;

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
AS $$
DECLARE
  v_run_key text;
  v_categories text[];
  v_category text := upper(NULLIF(btrim(p_category), ''));
BEGIN
  SELECT enabled_run_key, enabled_categories
  INTO v_run_key, v_categories
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
      AND (p_listing_type IS NULL OR upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type))
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
      AND (NOT p_images_only OR btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$')
    ORDER BY
      (CASE WHEN COALESCE(l.price_usd, l.price_normalized, 0) > 0 THEN 1 ELSE 0 END) DESC,
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
      COALESCE(l.original_timestamp, l.created_at) AS posting_date,
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
      CASE WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
        THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) ELSE NULL END AS user_image_url,
      l.created_at AS imported_at,
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
      CASE WHEN l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL)) THEN l.price_usd ELSE NULL END AS verified_price_usd,
      (l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) AS has_verified_usd_price,
      (COALESCE(l.reference_normalized, l.model_normalized, l.model_original) IS NOT NULL) AS has_complete_identity,
      l.trading_floor_status,
      regexp_replace(upper(COALESCE(l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      NULLIF(btrim(l.location), '') AS location,
      upper(l.category)::text AS item_category,
      CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED' OR
        upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
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
      (CASE WHEN COALESCE(l.price_usd, l.price_normalized, 0) > 0 THEN 1 ELSE 0 END) DESC,
      l.created_at DESC,
      l.id DESC
  ) contract;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_market_feed_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_market_feed_counts() TO service_role;
REVOKE ALL ON FUNCTION public.qnsa_market_feed_page_rows(text,text,integer,integer,text,boolean,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_market_feed_page_rows(text,text,integer,integer,text,boolean,text,timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
