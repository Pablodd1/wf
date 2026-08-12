-- Direct bounded customer rows for broad two-brand pages. This avoids asking
-- PostgreSQL to expand the full release view again after the page IDs are known.

CREATE OR REPLACE FUNCTION public.qnsa_trading_floor_page_rows(
  p_brand TEXT,
  p_limit INTEGER DEFAULT 51,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(row_data JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  SELECT to_jsonb(row_contract)
  FROM (
    SELECT
      l.id::text AS id,
      l.parent_id::text AS parent_id,
      'MARIADB_IMMUTABLE_RAW'::text AS source_file,
      1 AS source_row_number,
      l.source_record_id,
      l.created_at AS posting_date,
      COALESCE(l.user_name, l.from_name) AS seller_name,
      CASE WHEN l.contact_consent THEN COALESCE(l.contact_number, l.from_number) ELSE NULL END AS seller_phone,
      l.contact_consent AS contact_publication_approved,
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
        WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
        ELSE 'PRICE_NOT_SUPPLIED'
      END AS price_evidence_status,
      l.overall_confidence AS confidence,
      l.verdict,
      l.verdict AS verification_status,
      CASE
        WHEN l.public_image_eligible AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$'
          THEN btrim(l.image_url)
        ELSE NULL
      END AS user_image_url,
      l.created_at AS imported_at,
      (l.public_image_eligible AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
      CASE
        WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN l.price_usd
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN l.price_usd
        ELSE NULL
      END AS verified_price_usd,
      (
        l.price_usd > 0 AND (
          l.currency_normalized IN ('USD', 'USDT')
          OR (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL)
        )
      ) AS has_verified_usd_price,
      (l.reference_normalized IS NOT NULL AND btrim(l.reference_normalized) <> '') AS has_complete_identity,
      l.trading_floor_status,
      regexp_replace(upper(COALESCE(l.reference_normalized, l.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      NULLIF(btrim(l.location), '') AS location,
      'WATCH'::text AS item_category,
      CASE
        WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
          OR upper(COALESCE(l.publication_review_status, '')) = 'APPROVED' THEN 'APPROVED'
        ELSE 'PENDING_VERIFICATION'
      END AS publication_state,
      'QNSA_ROLEX_PATEK_REVIEWED_V1'::text AS publication_lane,
      true AS normalization_run_complete,
      true AS raw_lineage_verified,
      COALESCE(l.dealer_rating, l.rating) AS dealer_rating
    FROM public.qnsa_two_brand_release_control AS control
    JOIN staging.listings AS l
      ON l.normalization_run_key = control.enabled_run_key
     AND l.brand_normalized = control.canonical_brand
    JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
      ON checkpoint.run_key = l.normalization_run_key
    WHERE control.canonical_brand = p_brand
      AND control.trading_floor_enabled = true
      AND checkpoint.status = 'NORMALIZATION_STAGED' AND checkpoint.error_rows = 0
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle, false) = false
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
        'withdrawn', 'rejected', 'hidden', 'deleted', 'archived'
      )
      AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
      AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status, 'PENDING_REVIEW')) IN (
        'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
      )
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) AS row_contract;
$$;

REVOKE ALL ON FUNCTION public.qnsa_trading_floor_page_rows(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_trading_floor_page_rows(TEXT, INTEGER, INTEGER)
  TO service_role;
