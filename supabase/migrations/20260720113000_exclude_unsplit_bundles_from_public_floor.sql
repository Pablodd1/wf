-- Unsplit source messages are review material, not customer listings. Their
-- normalized children can return later as ordinary WTS/WTB records after
-- catalog confirmation and individual human approval.

CREATE OR REPLACE FUNCTION public.is_unsplit_bundle_parent(p_source_record_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.normalization_shadow_v4 shadow
    WHERE shadow.source_record_id = p_source_record_id
      AND shadow.candidate_count > 1
  );
$$;

REVOKE ALL ON FUNCTION public.is_unsplit_bundle_parent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_unsplit_bundle_parent(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unsplit_bundle_parent_ids(p_source_record_ids TEXT[])
RETURNS TABLE(source_record_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shadow.source_record_id
  FROM public.normalization_shadow_v4 shadow
  WHERE shadow.source_record_id = ANY(COALESCE(p_source_record_ids, ARRAY[]::TEXT[]))
    AND shadow.candidate_count > 1;
$$;

REVOKE ALL ON FUNCTION public.unsplit_bundle_parent_ids(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsplit_bundle_parent_ids(TEXT[]) TO service_role;

DROP POLICY IF EXISTS trading_floor_public_read ON public.watch_records;
CREATE POLICY trading_floor_public_read
  ON public.watch_records
  FOR SELECT
  TO anon, authenticated
  USING (
    listing_type IS DISTINCT FROM 'MULTI'
    AND NOT (COALESCE(flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
    AND NOT public.is_unsplit_bundle_parent(id)
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
  AND COALESCE(verdict, 'HUMAN') <> 'RECYCLE'
  AND COALESCE(listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED');

GRANT SELECT ON public.trading_floor_listings TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE VIEW public.dealer_profile_stats
WITH (security_invoker = true)
AS
WITH dated_posts AS (
  SELECT
    w.*,
    CASE
      WHEN w.listing_date ~ '^\d{4}-\d{2}-\d{2}'
        THEN left(w.listing_date, 10)::date::timestamptz
      ELSE NULL
    END AS observed_at
  FROM public.watch_records w
  WHERE w.listing_type IS DISTINCT FROM 'MULTI'
    AND NOT (COALESCE(w.flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
    AND NOT public.is_unsplit_bundle_parent(w.id)
    AND COALESCE(w.verdict, 'HUMAN') <> 'RECYCLE'
    AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
)
SELECT
  d.id AS dealer_id,
  count(w.id) AS total_posts,
  count(w.id) FILTER (WHERE w.listing_type = 'WTS') AS wts_posts,
  count(w.id) FILTER (WHERE w.listing_type IN ('WTB', 'NTQ')) AS wtb_posts,
  count(w.id) FILTER (
    WHERE w.listing_type = 'WTS'
      AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('SOLD', 'WITHDRAWN', 'EXPIRED')
  ) AS active_listings,
  min(w.observed_at) AS first_post_at,
  max(w.observed_at) AS last_post_at,
  count(DISTINCT extract(year FROM w.observed_at)) AS posting_years,
  count(w.id) FILTER (WHERE w.observed_at IS NOT NULL) AS dated_posts,
  count(w.id) FILTER (WHERE w.observed_at IS NULL) AS undated_posts
FROM public.dealers d
LEFT JOIN dated_posts w ON w.dealer_id = d.id
GROUP BY d.id;

REVOKE ALL ON public.dealer_profile_stats FROM anon, authenticated;
GRANT SELECT ON public.dealer_profile_stats TO service_role;

COMMENT ON FUNCTION public.is_unsplit_bundle_parent(TEXT) IS
  'Returns only whether deterministic normalization found multiple child candidates; exposes no raw source data.';

COMMENT ON FUNCTION public.unsplit_bundle_parent_ids(TEXT[]) IS
  'Service-only batch gate used to keep unsplit source parents out of market analytics.';

COMMENT ON VIEW public.dealer_profile_stats IS
  'Verified dealer activity excluding unsplit bundle parents; dates use immutable source listing_date only.';
