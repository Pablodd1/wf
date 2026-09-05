-- Storage-light non-watch customer feed. Reuses
-- idx_staging_qnsa_market_feed_page and deliberately avoids another index.
-- Candidate IDs are selected first through the existing category index; only
-- that <=101-row page is then joined to immutable raw evidence.

CREATE OR REPLACE FUNCTION public.qnsa_non_watch_market_page_rows(
  p_category text,
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
  IF v_category IS NULL OR v_category NOT IN ('HANDBAG', 'JEWELRY', 'ACCESSORY') THEN
    RETURN;
  END IF;

  SELECT enabled_run_key, enabled_categories
  INTO v_run_key, v_categories
  FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true;

  IF v_run_key IS NULL OR NOT (v_category = ANY(v_categories)) THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings l
    WHERE l.normalization_run_key = v_run_key
      AND l.category = v_category
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND l.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'
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
    ORDER BY l.created_at DESC, l.id DESC
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
      COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), '')) AS seller_name,
      CASE WHEN COALESCE(l.contact_consent, false)
        THEN COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''))
        ELSE NULL END AS seller_phone,
      COALESCE(l.contact_consent, false) AS contact_publication_approved,
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
      NULL::text AS dial_color,
      NULL::text AS catalog_dial,
      l.condition_normalized AS condition,
      l.price_usd AS workbook_price_usd,
      l.price_normalized AS source_price_amount,
      l.currency_normalized AS source_currency,
      CASE
        WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
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
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL)) THEN l.price_usd ELSE NULL END AS verified_price_usd,
      (l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source), '') IS NOT NULL))) AS has_verified_usd_price,
      (NULLIF(btrim(COALESCE(l.model_normalized, l.model_original, '')), '') IS NOT NULL) AS has_complete_identity,
      l.trading_floor_status,
      regexp_replace(upper(COALESCE(l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      NULLIF(btrim(l.location), '') AS location,
      upper(l.category)::text AS item_category,
      CASE WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED' OR
        upper(COALESCE(l.publication_review_status, '')) = 'APPROVED'
        THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END AS publication_state,
      'QNSA_NON_WATCH_FEED_V1'::text AS publication_lane,
      true AS normalization_run_complete,
      true AS raw_lineage_verified,
      COALESCE(l.dealer_rating, l.rating) AS dealer_rating,
      NULL::integer AS review_count
    FROM eligible e
    JOIN staging.listings l ON l.id = e.id
    JOIN public.raw_message_versions rv
      ON rv.id = l.raw_message_version_id
     AND rv.source_record_id = l.source_record_id
     AND rv.source_hash = l.source_hash
    ORDER BY l.created_at DESC, l.id DESC
  ) contract;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_non_watch_market_page_rows(text,integer,integer,text,boolean,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_non_watch_market_page_rows(text,integer,integer,text,boolean,text,timestamptz)
  TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
