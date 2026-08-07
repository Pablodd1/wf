-- Verified customer read model for Rolex, Patek Philippe, and Audemars Piguet.
--
-- This migration changes no watch_records rows and creates the cache WITH NO
-- DATA. The audited release workflow must refresh it only after a signed
-- staging readback reconciles exactly.

BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE VIEW public.three_brand_verified_trading_release
WITH (security_invoker = true) AS
WITH candidates AS (
  SELECT
    w.id,
    trim(r.canonical_brand) AS brand,
    trim(r.canonical_model) AS model,
    trim(r.canonical_reference) AS reference,
    trim(r.canonical_dial_color) AS dial_color,
    w.condition,
    w.year,
    w.price_raw,
    w.price_usd,
    w.currency,
    w.confidence,
    w.verdict,
    w.source,
    w.source_type,
    w.listing_type,
    w.listing_date,
    w.listing_status,
    w.created_at,
    media.public_url IS NOT NULL AS has_images,
    media.public_url AS thumbnail_url,
    CASE
      WHEN media.public_url IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(media.public_url)
    END AS image_urls,
    w.region,
    r.status AS identity_review_status,
    public.two_brand_repost_signature(
      w.id,
      w.dealer_id::text,
      w.raw_message,
      r.canonical_brand,
      r.canonical_reference,
      r.canonical_dial_color,
      w.condition,
      w.price_usd::double precision
    ) AS repost_signature
  FROM public.watch_records w
  JOIN public.listing_identity_reviews r
    ON r.record_id = w.id
   AND r.status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED')
  LEFT JOIN LATERAL (
    SELECT manifest.public_url
    FROM public.listing_image_reviews image_review
    JOIN public.media_manifest manifest
      ON manifest.source_object_key = image_review.source_object_key
     AND manifest.matched_record_id = image_review.record_id
    WHERE image_review.record_id = w.id
      AND image_review.status = 'VISUALLY_VERIFIED'
      AND lower(trim(image_review.identity_snapshot->>'brand')) =
        lower(trim(r.canonical_brand))
      AND lower(trim(image_review.identity_snapshot->>'model')) =
        lower(trim(r.canonical_model))
      AND lower(trim(image_review.identity_snapshot->>'reference')) =
        lower(trim(r.canonical_reference))
      AND lower(trim(image_review.identity_snapshot->>'dial_color')) =
        lower(trim(r.canonical_dial_color))
    ORDER BY image_review.reviewed_at DESC NULLS LAST,
      image_review.source_object_key
    LIMIT 1
  ) media ON true
  WHERE lower(trim(r.canonical_brand)) IN (
      'rolex',
      'patek philippe',
      'audemars piguet'
    )
    AND NULLIF(trim(r.canonical_model), '') IS NOT NULL
    AND NULLIF(trim(r.canonical_reference), '') IS NOT NULL
    AND NULLIF(trim(r.canonical_dial_color), '') IS NOT NULL
    AND w.listing_type IN ('WTS', 'WTB', 'NTQ')
    AND w.verdict = 'APPROVED'
    AND w.confidence >= 90
    AND NOT (
      COALESCE(w.flags, '[]'::jsonb)
        @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.normalization_shadow_v4 shadow
      WHERE shadow.source_record_id = w.id
        AND (
          shadow.candidate_count > 1
          OR 'BUNDLE_SPLIT_REQUIRED' =
            ANY(COALESCE(shadow.change_flags, ARRAY[]::text[]))
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.duplicate_review_candidates duplicate
      WHERE duplicate.duplicate_id = w.id
        AND duplicate.status = 'SUPPRESSED'
    )
    AND COALESCE(w.listing_status, 'ACTIVE')
      NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
    AND w.id NOT LIKE 'preview_demo_%'
), ranked AS (
  SELECT
    candidates.*,
    row_number() OVER (
      PARTITION BY repost_signature
      ORDER BY has_images DESC, created_at DESC NULLS LAST, id DESC
    ) AS repost_rank
  FROM candidates
)
SELECT
  id,
  brand,
  model,
  reference,
  dial_color,
  condition,
  year,
  price_raw,
  price_usd,
  currency,
  confidence,
  verdict,
  source,
  source_type,
  listing_type,
  listing_date,
  listing_status,
  created_at,
  has_images,
  thumbnail_url,
  image_urls,
  region,
  identity_review_status
FROM ranked
WHERE repost_rank = 1;

REVOKE ALL ON public.three_brand_verified_trading_release
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.three_brand_verified_trading_release TO service_role;

COMMENT ON VIEW public.three_brand_verified_trading_release IS
  'Service-only, globally deduplicated Rolex/Patek/Audemars release. WTS price is optional on Trading Floor; Price Research retains its separate evidence gate.';

CREATE MATERIALIZED VIEW IF NOT EXISTS
  public.three_brand_verified_trading_release_cache
AS
SELECT *
FROM public.three_brand_verified_trading_release
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_three_brand_release_cache_id
  ON public.three_brand_verified_trading_release_cache (id);

CREATE INDEX IF NOT EXISTS idx_three_brand_release_cache_brand_price
  ON public.three_brand_verified_trading_release_cache
    (brand, price_usd DESC NULLS LAST, created_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_three_brand_release_cache_reference
  ON public.three_brand_verified_trading_release_cache
    (brand, reference, dial_color, created_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_three_brand_release_cache_type_price
  ON public.three_brand_verified_trading_release_cache
    (
      listing_type,
      brand,
      price_usd DESC NULLS LAST,
      created_at DESC NULLS LAST,
      id DESC
    );

REVOKE ALL ON public.three_brand_verified_trading_release_cache
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.three_brand_verified_trading_release_cache
  TO service_role;

COMMENT ON MATERIALIZED VIEW
  public.three_brand_verified_trading_release_cache IS
  'Empty-on-create service cache. Refresh only after exact signed three-brand staging reconciliation; watch_records remains immutable during canaries.';

NOTIFY pgrst, 'reload schema';
COMMIT;
