-- Full Rolex/Patek customer release.
--
-- This migration does not mutate watch_records. It moves global repost
-- selection and pagination eligibility into Postgres so the customer API no
-- longer has to load the complete reviewed population into application memory.

BEGIN;
-- Supabase Preview may hold a short schema-cache lock while integrations apply
-- the same branch. Wait long enough for that bounded lock instead of failing a
-- data-less preview; the 120-second statement timeout remains the hard stop.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

CREATE INDEX IF NOT EXISTS idx_listing_identity_release_brand_status_record
  ON public.listing_identity_reviews (canonical_brand, status, record_id)
  INCLUDE (canonical_model, canonical_reference, canonical_dial_color, updated_at)
  WHERE status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED');

CREATE INDEX IF NOT EXISTS idx_listing_identity_review_brand_status_updated
  ON public.listing_identity_reviews (canonical_brand, status, updated_at DESC, record_id DESC)
  WHERE status IN ('UNVERIFIED', 'CONFLICT');

CREATE OR REPLACE FUNCTION public.two_brand_repost_signature(
  p_record_id TEXT,
  p_dealer_id TEXT,
  p_raw_message TEXT,
  p_brand TEXT,
  p_reference TEXT,
  p_dial_color TEXT,
  p_condition TEXT,
  p_price_usd DOUBLE PRECISION
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH normalized AS (
    SELECT
      upper(regexp_replace(COALESCE(p_dealer_id, ''), '[^A-Za-z0-9]', '', 'g')) AS dealer_id,
      regexp_replace(
        COALESCE(substring(COALESCE(p_raw_message, '') FROM '[+][0-9][0-9 ()-]{7,18}'), ''),
        '[^0-9]',
        '',
        'g'
      ) AS observed_phone,
      upper(trim(regexp_replace(
        regexp_replace(
          COALESCE(p_raw_message, ''),
          '^[[:space:]]*\[[^]]{3,80}\][[:space:]]*[+]?[0-9][0-9 ()-]{7,18}[[:space:]]*:[[:space:]]*',
          '',
          'i'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      ))) AS normalized_message,
      concat_ws('|',
        upper(regexp_replace(COALESCE(p_brand, ''), '[^A-Za-z0-9]', '', 'g')),
        upper(regexp_replace(COALESCE(p_reference, ''), '[^A-Za-z0-9]', '', 'g')),
        upper(regexp_replace(COALESCE(p_dial_color, ''), '[^A-Za-z0-9]', '', 'g')),
        upper(regexp_replace(COALESCE(p_condition, ''), '[^A-Za-z0-9]', '', 'g')),
        round(COALESCE(p_price_usd, 0))::TEXT
      ) AS identity
  )
  SELECT CASE
    WHEN dealer_id <> '' THEN 'VERIFIED_DEALER:' || dealer_id || '|' || identity
    WHEN observed_phone <> '' THEN 'OBSERVED_PHONE:' || observed_phone || '|' || identity
    WHEN normalized_message <> '' THEN 'MESSAGE:' || normalized_message || '|' || identity
    ELSE 'RECORD:' || COALESCE(p_record_id, '')
  END
  FROM normalized;
$$;

REVOKE ALL ON FUNCTION public.two_brand_repost_signature(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_brand_repost_signature(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION
) TO service_role;

CREATE OR REPLACE VIEW public.two_brand_verified_trading_release
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
      AND lower(trim(image_review.identity_snapshot->>'brand')) = lower(trim(r.canonical_brand))
      AND lower(trim(image_review.identity_snapshot->>'model')) = lower(trim(r.canonical_model))
      AND lower(trim(image_review.identity_snapshot->>'reference')) = lower(trim(r.canonical_reference))
      AND lower(trim(image_review.identity_snapshot->>'dial_color')) = lower(trim(r.canonical_dial_color))
    ORDER BY image_review.reviewed_at DESC NULLS LAST, image_review.source_object_key
    LIMIT 1
  ) media ON true
  WHERE lower(trim(r.canonical_brand)) IN ('rolex', 'patek philippe')
    AND NULLIF(trim(r.canonical_model), '') IS NOT NULL
    AND NULLIF(trim(r.canonical_reference), '') IS NOT NULL
    AND NULLIF(trim(r.canonical_dial_color), '') IS NOT NULL
    AND w.listing_type IN ('WTS', 'WTB', 'NTQ')
    AND w.verdict = 'APPROVED'
    AND w.confidence >= 90
    AND (
      w.listing_type IN ('WTB', 'NTQ')
      OR (
        w.listing_type = 'WTS'
        AND w.price_usd IS NOT NULL
        AND w.price_usd >= 1000
      )
    )
    AND NOT (COALESCE(w.flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
    AND NOT EXISTS (
      SELECT 1
      FROM public.normalization_shadow_v4 shadow
      WHERE shadow.source_record_id = w.id
        AND (
          shadow.candidate_count > 1
          OR 'BUNDLE_SPLIT_REQUIRED' = ANY(COALESCE(shadow.change_flags, ARRAY[]::text[]))
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.duplicate_review_candidates duplicate
      WHERE duplicate.duplicate_id = w.id
        AND duplicate.status = 'SUPPRESSED'
    )
    AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
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

REVOKE ALL ON public.two_brand_verified_trading_release
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.two_brand_verified_trading_release TO service_role;

CREATE OR REPLACE VIEW public.two_brand_identity_review_queue
WITH (security_invoker = true) AS
WITH unresolved AS (
  SELECT
    w.*,
    COALESCE(NULLIF(trim(r.status), ''), 'UNVERIFIED') AS identity_status,
    COALESCE(NULLIF(trim(r.canonical_brand), ''), w.brand) AS review_brand,
    COALESCE(NULLIF(trim(r.canonical_model), ''), w.model) AS review_model,
    COALESCE(NULLIF(trim(r.canonical_reference), ''), w.reference) AS review_reference,
    COALESCE(NULLIF(trim(r.canonical_dial_color), ''), w.dial_color) AS review_dial_color,
    COALESCE(r.evidence, '{}'::jsonb) AS prior_identity_evidence,
    CASE
      WHEN w.listing_type = 'MULTI' THEN true
      WHEN COALESCE(w.flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb THEN true
      WHEN COALESCE(w.verdict, 'HUMAN') = 'APPROVED'
        AND COALESCE(w.confidence, 0) >= 90
        THEN EXISTS (
          SELECT 1
          FROM public.normalization_shadow_v4 shadow
          WHERE shadow.source_record_id = w.id
            AND (
              shadow.candidate_count > 1
              OR 'BUNDLE_SPLIT_REQUIRED' = ANY(COALESCE(shadow.change_flags, ARRAY[]::text[]))
            )
        )
      ELSE false
    END AS bundle_blocked,
    CASE
      WHEN COALESCE(w.verdict, 'HUMAN') = 'APPROVED'
        AND COALESCE(w.confidence, 0) >= 90
        AND w.listing_type IN ('WTS', 'WTB', 'NTQ')
        THEN EXISTS (
          SELECT 1
          FROM public.duplicate_review_candidates duplicate
          WHERE duplicate.duplicate_id = w.id
            AND duplicate.status = 'SUPPRESSED'
        )
      ELSE false
    END AS duplicate_blocked,
    CASE
      WHEN w.listing_type IN ('WTB', 'NTQ') THEN true
      WHEN w.listing_type = 'WTS'
        AND w.price_usd IS NOT NULL
        AND w.price_usd >= 1000 THEN true
      ELSE false
    END AS market_ready
  FROM public.watch_records w
  LEFT JOIN public.listing_identity_reviews r ON r.record_id = w.id
  WHERE lower(trim(COALESCE(NULLIF(r.canonical_brand, ''), w.brand))) IN ('rolex', 'patek philippe')
    AND COALESCE(r.status, 'UNVERIFIED') IN ('UNVERIFIED', 'CONFLICT')
    AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
)
SELECT
  id AS record_id,
  identity_status,
  review_brand AS brand,
  review_model AS model,
  review_reference AS reference,
  review_dial_color AS dial_color,
  condition,
  year,
  price_raw,
  price_usd,
  currency,
  listing_type,
  verdict,
  confidence,
  raw_message,
  source,
  source_type,
  listing_date,
  created_at,
  seller_name,
  seller_phone,
  dealer_id,
  thumbnail_url,
  image_urls,
  has_images,
  prior_identity_evidence,
  array_remove(ARRAY[
    CASE WHEN raw_message IS NULL OR trim(raw_message) = '' THEN 'RAW_EVIDENCE_MISSING' END,
    CASE WHEN COALESCE(verdict, 'HUMAN') <> 'APPROVED' THEN 'NORMALIZATION_NOT_APPROVED' END,
    CASE WHEN COALESCE(confidence, 0) < 90 THEN 'CONFIDENCE_BELOW_90' END,
    CASE WHEN bundle_blocked THEN 'BUNDLE_REVIEW_REQUIRED' END,
    CASE WHEN duplicate_blocked THEN 'DUPLICATE_SUPPRESSED' END,
    CASE WHEN NOT market_ready THEN 'MARKET_DATA_REVIEW_REQUIRED' END,
    CASE WHEN identity_status = 'CONFLICT'
      THEN 'IDENTITY_CONFLICT' END
  ], NULL)::text[] AS release_blockers,
  CASE
    WHEN raw_message IS NULL OR trim(raw_message) = '' THEN 'MISSING_RAW_EVIDENCE'
    WHEN COALESCE(verdict, 'HUMAN') <> 'APPROVED'
      OR COALESCE(confidence, 0) < 90 THEN 'NORMALIZATION_REVIEW_REQUIRED'
    WHEN bundle_blocked THEN 'BUNDLE_REVIEW_REQUIRED'
    WHEN duplicate_blocked THEN 'DUPLICATE_SUPPRESSED'
    WHEN NOT market_ready THEN 'MARKET_REVIEW_REQUIRED'
    ELSE 'READY_FOR_IDENTITY_REVIEW'
  END AS review_disposition,
  flags
FROM unresolved;

REVOKE ALL ON public.two_brand_identity_review_queue
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.two_brand_identity_review_queue TO service_role;

COMMENT ON VIEW public.two_brand_verified_trading_release IS
  'Service-only, globally deduplicated Rolex/Patek release. Every row has reviewed canonical identity, APPROVED verdict, confidence >= 90, complete identity, and existing bundle/duplicate publication gates.';
COMMENT ON VIEW public.two_brand_identity_review_queue IS
  'Service-only routed evidence queue for unresolved Rolex/Patek identities. READY_FOR_IDENTITY_REVIEW means identity is the final release blocker; decisions remain audited and never mutate watch_records.';

NOTIFY pgrst, 'reload schema';
COMMIT;
