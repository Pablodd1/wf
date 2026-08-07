-- Dealer history must use the original source posting date. created_at is the
-- database import timestamp and is not acceptable evidence of market activity.

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
)
SELECT
  d.id AS dealer_id,
  count(w.id) AS total_posts,
  count(w.id) FILTER (WHERE w.listing_type = 'WTS') AS wts_posts,
  count(w.id) FILTER (WHERE w.listing_type IN ('WTB', 'NTQ')) AS wtb_posts,
  count(w.id) FILTER (
    WHERE w.listing_type = 'WTS'
      AND coalesce(w.listing_status, 'ACTIVE') NOT IN ('SOLD', 'WITHDRAWN', 'EXPIRED')
      AND coalesce(w.verdict, '') <> 'RECYCLE'
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

COMMENT ON VIEW public.dealer_profile_stats IS
  'Dealer WTS, WTB/NTQ, and dated activity derived from immutable listing lineage. Import created_at is never used as a posting date.';
