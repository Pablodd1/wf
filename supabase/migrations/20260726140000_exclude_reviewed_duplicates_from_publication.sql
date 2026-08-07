-- Human-reviewed duplicate suppression is a reversible publication decision.
-- Source evidence and watch_records remain unchanged. Changing the ledger row
-- away from SUPPRESSED makes the listing eligible again.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS idx_duplicate_review_suppressed_duplicate
  ON public.duplicate_review_candidates (duplicate_id)
  WHERE status = 'SUPPRESSED';

CREATE OR REPLACE FUNCTION public.is_listing_duplicate_eligible(p_record_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.duplicate_review_candidates d
    WHERE d.duplicate_id = p_record_id
      AND d.status = 'SUPPRESSED'
  );
$$;

REVOKE ALL ON FUNCTION public.is_listing_duplicate_eligible(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_listing_duplicate_eligible(TEXT)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reviewed_suppressed_duplicate_ids(p_duplicate_ids TEXT[])
RETURNS TABLE(duplicate_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT d.duplicate_id
  FROM public.duplicate_review_candidates d
  WHERE d.status = 'SUPPRESSED'
    AND cardinality(COALESCE(p_duplicate_ids, ARRAY[]::TEXT[])) BETWEEN 1 AND 1000
    AND d.duplicate_id = ANY(COALESCE(p_duplicate_ids, ARRAY[]::TEXT[]));
$$;

REVOKE ALL ON FUNCTION public.reviewed_suppressed_duplicate_ids(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reviewed_suppressed_duplicate_ids(TEXT[])
  TO service_role;

DROP POLICY IF EXISTS trading_floor_public_read ON public.watch_records;
CREATE POLICY trading_floor_public_read
  ON public.watch_records
  FOR SELECT
  TO anon, authenticated
  USING (
    listing_type IS DISTINCT FROM 'MULTI'
    AND NOT (COALESCE(flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
    AND NOT public.is_unsplit_bundle_parent(id)
    AND public.is_listing_duplicate_eligible(id)
    AND (
      listing_type IN ('WTS', 'WTB', 'NTQ', 'OTHER')
      OR reference IS NOT NULL
      OR brand IS NOT NULL
    )
    AND COALESCE(verdict, 'HUMAN') <> 'RECYCLE'
    AND COALESCE(listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
  );

CREATE OR REPLACE VIEW public.trading_floor_listings
WITH (security_invoker = true) AS
SELECT
  id,
  brand,
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
  region
FROM public.watch_records
WHERE listing_type IS DISTINCT FROM 'MULTI'
  AND NOT (COALESCE(flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
  AND NOT public.is_unsplit_bundle_parent(id)
  AND public.is_listing_duplicate_eligible(id)
  AND COALESCE(verdict, 'HUMAN') <> 'RECYCLE'
  AND COALESCE(listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED');

GRANT SELECT ON public.trading_floor_listings TO anon, authenticated;

CREATE OR REPLACE VIEW public.price_research_verified_source
WITH (security_invoker = true) AS
SELECT
  w.id,
  COALESCE(NULLIF(r.canonical_brand, ''), w.brand) AS brand,
  COALESCE(NULLIF(r.canonical_model, ''), w.model) AS model,
  COALESCE(NULLIF(r.canonical_reference, ''), w.reference) AS reference,
  COALESCE(NULLIF(r.canonical_dial_color, ''), w.dial_color) AS dial_color,
  w.price_raw,
  w.price_usd,
  w.currency,
  w.raw_message,
  w.flags,
  w.created_at,
  w.listing_date,
  w.condition,
  w.source,
  w.year,
  w.listing_type,
  w.dealer_id,
  w.confidence,
  w.thumbnail_url,
  w.image_urls,
  w.has_images,
  w.verdict,
  w.listing_status
FROM public.watch_records w
JOIN public.listing_identity_reviews r
  ON r.record_id = w.id
 AND r.status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED')
WHERE NOT public.is_unsplit_bundle_parent(w.id)
  AND w.listing_type IS DISTINCT FROM 'MULTI'
  AND COALESCE(w.verdict, 'HUMAN') <> 'RECYCLE'
  AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
  AND NOT EXISTS (
    SELECT 1
    FROM public.duplicate_review_candidates d
    WHERE d.duplicate_id = w.id
      AND d.status = 'SUPPRESSED'
  );

REVOKE ALL ON public.price_research_verified_source FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.price_research_verified_source TO service_role;

COMMENT ON FUNCTION public.is_listing_duplicate_eligible(TEXT) IS
  'Returns false only for duplicate IDs with a current human-reviewed SUPPRESSED decision; indexed and reversible without mutating watch_records.';
COMMENT ON FUNCTION public.reviewed_suppressed_duplicate_ids(TEXT[]) IS
  'Returns reviewed suppressed IDs only within a caller-provided bounded Price Research cohort; never scans or returns the global suppression ledger.';
COMMENT ON VIEW public.trading_floor_listings IS
  'Customer-safe Trading Floor archive excluding unsplit parents and currently suppressed reviewed duplicates; immutable source rows remain preserved.';
COMMENT ON VIEW public.price_research_verified_source IS
  'Strict service-only Price Research source excluding unsplit parents and all currently suppressed reviewed duplicate IDs without a client-side row cap.';

NOTIFY pgrst, 'reload schema';
COMMIT;
