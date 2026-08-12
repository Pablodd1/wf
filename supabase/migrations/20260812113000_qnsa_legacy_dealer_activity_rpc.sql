BEGIN;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_company_activity_20260812
  ON staging.listings (normalization_run_key, company_id, listing_type, created_at DESC, id DESC)
  WHERE company_id IS NOT NULL
    AND parent_id IS NULL
    AND is_bundle = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND upper(COALESCE(brand_normalized, '')) IN ('ROLEX', 'PATEK PHILIPPE');

CREATE OR REPLACE FUNCTION public.qnsa_legacy_dealer_activity(
  p_legacy_profile_id integer,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $function$
  WITH enabled_run AS (
    SELECT enabled_run_key AS normalization_run_key
    FROM public.qnsa_two_brand_release_control
    WHERE trading_floor_enabled = true
      AND enabled_run_key IS NOT NULL
    ORDER BY updated_at DESC, normalization_run_key DESC
    LIMIT 1
  ),
  eligible AS (
    SELECT l.*
    FROM staging.listings AS l
    JOIN enabled_run AS r USING (normalization_run_key)
    WHERE l.company_id = p_legacy_profile_id
      AND l.parent_id IS NULL
      AND l.is_bundle = false
      AND upper(COALESCE(l.category, '')) = 'WATCH'
      AND upper(COALESCE(l.brand_normalized, '')) IN ('ROLEX', 'PATEK PHILIPPE')
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'rejected', 'hidden', 'deleted', 'archived'
      )
  ),
  totals AS (
    SELECT
      count(*) FILTER (WHERE upper(COALESCE(listing_type, intent, '')) = 'WTS') AS wts_count,
      count(*) FILTER (WHERE upper(COALESCE(listing_type, intent, '')) = 'WTB') AS wtb_count,
      min(created_at) AS first_post,
      max(created_at) AS latest_post
    FROM eligible
  ),
  newest AS (
    SELECT *
    FROM eligible
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  )
  SELECT jsonb_build_object(
    'legacy_profile_id', p_legacy_profile_id,
    'wts_count', totals.wts_count,
    'wtb_count', totals.wtb_count,
    'first_post', totals.first_post,
    'latest_post', totals.latest_post,
    'listings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id::text,
        'brand', n.brand_normalized,
        'model', n.model_normalized,
        'reference', n.reference_normalized,
        'dial_color', n.dial_color_normalized,
        'condition', n.condition_normalized,
        'price_usd', CASE WHEN n.price_usd > 0 THEN n.price_usd ELSE NULL END,
        'price_raw', CASE WHEN n.price_normalized > 0 THEN n.price_normalized ELSE NULL END,
        'currency', n.currency_normalized,
        'listing_type', upper(COALESCE(n.listing_type, n.intent)),
        'listing_date', n.created_at,
        'raw_message', n.raw_message_text,
        'image_url', CASE
          WHEN n.public_image_eligible = true
            AND btrim(COALESCE(n.image_url, '')) ~* '^https?://[^[:space:]]+$'
            THEN btrim(n.image_url)
          ELSE NULL
        END,
        'seller_name', COALESCE(NULLIF(btrim(n.user_name), ''), NULLIF(btrim(n.from_name), '')),
        'seller_phone', CASE WHEN n.contact_consent THEN COALESCE(n.contact_number, n.from_number) ELSE NULL END,
        'location', n.location,
        'dealer_rating', COALESCE(n.dealer_rating, n.rating)
      ) ORDER BY n.created_at DESC NULLS LAST, n.id DESC)
      FROM newest AS n
    ), '[]'::jsonb)
  )
  FROM totals;
$function$;

REVOKE ALL ON FUNCTION public.qnsa_legacy_dealer_activity(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_legacy_dealer_activity(integer, integer) TO service_role;

COMMIT;
