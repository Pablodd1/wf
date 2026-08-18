BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_bounded_price_research_rows(
  p_brand text,
  p_references text[],
  p_listing_type text,
  p_limit integer DEFAULT 1000
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $function$
  WITH eligible_ids AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings AS l
    JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
      ON checkpoint.run_key = l.normalization_run_key
    JOIN public.qnsa_two_brand_release_control AS control
      ON control.canonical_brand = l.brand_normalized
     AND control.enabled_run_key = l.normalization_run_key
    WHERE l.brand_normalized = p_brand
      AND l.reference_normalized = ANY (p_references)
      AND upper(COALESCE(l.listing_type, l.intent, '')) = upper(p_listing_type)
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL
      AND COALESCE(l.is_bundle, false) = false
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND checkpoint.status = 'NORMALIZATION_STAGED'
      AND checkpoint.error_rows = 0
      AND control.price_research_enabled = true
      AND l.raw_message_version_id IS NOT NULL
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
        upper(p_listing_type) = 'WTB'
        OR (
          upper(p_listing_type) = 'WTS'
          AND l.price_usd > 0
          AND l.price_normalized > 0
          AND (
            l.currency_normalized IN ('USD', 'USDT')
            OR (
              l.currency_normalized IS NOT NULL
              AND l.conversion_rate > 0
              AND l.conversion_timestamp IS NOT NULL
            )
          )
        )
      )
    ORDER BY l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 2500)
  )
  SELECT jsonb_build_object(
    'id', l.id::text,
    'brand', l.brand_normalized,
    'model', l.model_normalized,
    'reference', l.reference_normalized,
    'dial_color', l.dial_color_normalized,
    'condition', l.condition_normalized,
    'listing_type', upper(COALESCE(l.listing_type, l.intent, '')),
    'verdict', l.verdict,
    'confidence', l.overall_confidence,
    'raw_message', l.raw_message_text,
    'dealer_id', l.company_id::text,
    'source', 'MARIADB_IMMUTABLE_RAW',
    'seller_name', COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(l.from_name), ''),
      NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')),
    'seller_phone', COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(l.from_number), ''),
      NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), '')),
    'seller_rating', COALESCE(l.dealer_rating, l.rating,
      CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
        THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END),
    'location', COALESCE(NULLIF(btrim(l.location), ''),
      NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')),
    'thumbnail_url', CASE
      WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(COALESCE(l.image_url, l.source_media_url_candidate))
    END,
    'image_urls', CASE
      WHEN btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$'
      THEN jsonb_build_array(btrim(COALESCE(l.image_url, l.source_media_url_candidate)))
      ELSE '[]'::jsonb
    END,
    'has_images', btrim(COALESCE(l.image_url, l.source_media_url_candidate, '')) ~* '^https?://[^[:space:]]+$',
    'price_raw', l.price_normalized,
    'price_usd', l.price_usd,
    'currency', l.currency_normalized,
    'created_at', l.created_at,
    'listing_date', l.created_at,
    'listing_status', l.trading_floor_status,
    'owner_reviewed_identity', true
  )
  FROM eligible_ids AS eligible
  JOIN staging.listings AS l ON l.id = eligible.id
  JOIN public.raw_message_versions AS rv
    ON rv.id = l.raw_message_version_id
   AND rv.source_record_id = l.source_record_id
   AND rv.source_hash = l.source_hash;
$function$;

REVOKE ALL ON FUNCTION public.qnsa_bounded_price_research_rows(text, text[], text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qnsa_bounded_price_research_rows(text, text[], text, integer)
  TO anon, authenticated, service_role, postgres, supabase_admin;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_price_reference_rpc
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized,
    listing_type,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe');

COMMIT;
