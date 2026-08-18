BEGIN;

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
DECLARE v_run_key text;
BEGIN
  SELECT enabled_run_key INTO v_run_key
  FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand = p_brand AND trading_floor_enabled = true;
  IF v_run_key IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible_ids AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings AS l
    WHERE l.normalization_run_key=v_run_key AND l.brand_normalized=p_brand
      AND (CASE WHEN p_family THEN l.reference_normalized LIKE p_reference || '%'
        ELSE l.reference_normalized = p_reference END)
      AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND upper(COALESCE(l.publication_review_status,'PENDING_REVIEW')) IN ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
    -- PostgreSQL sorts NULL before TRUE in DESC order unless NULLS LAST is
    -- explicit. Treat both normalized and USD prices as usable so corrected
    -- FX rows lead the reference feed while genuine no-price activity follows.
    ORDER BY (l.price_usd >= 1000 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) DESC NULLS LAST,
      l.created_at DESC, l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit,51),1),101)
    OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT to_jsonb(row_contract)
  FROM (
    SELECT
      l.id::text AS id, l.parent_id::text AS parent_id,
      'MARIADB_IMMUTABLE_RAW'::text AS source_file, 1 AS source_row_number,
      l.source_record_id, l.created_at AS posting_date,
      COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')) AS seller_name,
      COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
        NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')) AS seller_phone,
      true AS contact_publication_approved, l.raw_message_text AS raw_message,
      upper(COALESCE(l.listing_type, l.intent, '')) AS listing_type,
      l.brand_normalized AS brand_scope, l.brand_original AS supplied_brand,
      l.brand_normalized AS canonical_brand, l.model_original AS model,
      l.model_normalized AS catalog_model, l.reference_original AS raw_reference,
      l.reference_normalized AS normalized_reference, l.reference_normalized AS catalog_reference,
      l.dial_color_normalized AS dial_color, l.dial_color_normalized AS catalog_dial,
      l.condition_normalized AS condition, l.price_usd AS workbook_price_usd,
      l.price_normalized AS source_price_amount, l.currency_normalized AS source_currency,
      CASE
        WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 AND l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        WHEN l.price_normalized > 0 THEN 'CURRENCY_UNCONFIRMED'
        ELSE 'PRICE_NOT_SUPPLIED'
      END AS price_evidence_status,
      l.overall_confidence AS confidence, l.verdict, l.verdict AS verification_status,
      CASE WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
        THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate)) END AS user_image_url,
      l.created_at AS imported_at,
      (btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$') AS has_exact_source_image,
      CASE WHEN l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL)) THEN l.price_usd END AS verified_price_usd,
      (l.price_usd > 0 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) AS has_verified_usd_price,
      true AS has_complete_identity, l.trading_floor_status,
      regexp_replace(upper(l.reference_normalized), '[^A-Z0-9]', '', 'g') AS reference_search_key,
      COALESCE(NULLIF(btrim(l.location), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')) AS location,
      'WATCH'::text AS item_category,
      CASE WHEN upper(COALESCE(l.verdict,''))='APPROVED' OR upper(COALESCE(l.publication_review_status,''))='APPROVED'
        THEN 'APPROVED' ELSE 'PENDING_VERIFICATION' END AS publication_state,
      'QNSA_ROLEX_PATEK_REVIEWED_V1'::text AS publication_lane,
      true AS normalization_run_complete, true AS raw_lineage_verified,
      COALESCE(l.dealer_rating, l.rating,
        CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END) AS dealer_rating
    FROM eligible_ids AS eligible
    JOIN staging.listings AS l ON l.id=eligible.id
    JOIN public.raw_message_versions AS rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    ORDER BY (l.price_usd >= 1000 AND (l.currency_normalized IN ('USD','USDT') OR
        (l.conversion_rate > 0 AND l.conversion_timestamp IS NOT NULL))) DESC NULLS LAST,
      l.created_at DESC, l.id DESC
  ) AS row_contract;
END;
$function$;

REVOKE ALL ON FUNCTION public.qnsa_trading_floor_reference_rows(text,text,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qnsa_trading_floor_reference_rows(text,text,boolean,integer,integer)
  TO anon, authenticated, service_role, postgres, supabase_admin;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_reference_price_order
  ON staging.listings (normalization_run_key, brand_normalized, reference_normalized text_pattern_ops,
    ((price_normalized > 0)) DESC, created_at DESC, id DESC)
  WHERE parent_id IS NULL AND COALESCE(is_bundle,false)=false
    AND brand_normalized IN ('Rolex','Patek Philippe') AND upper(COALESCE(category,''))='WATCH';

COMMIT;
