-- Fast customer read model for the globally deduplicated Rolex/Patek release.
--
-- The authoritative view remains the source of truth. This materialized copy
-- is refreshed only by the audited release workflow so customer requests do
-- not recompute global repost ranking across the full reviewed population.

BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

CREATE MATERIALIZED VIEW IF NOT EXISTS public.two_brand_verified_trading_release_cache
AS
SELECT *
FROM public.two_brand_verified_trading_release
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_two_brand_release_cache_id
  ON public.two_brand_verified_trading_release_cache (id);

CREATE INDEX IF NOT EXISTS idx_two_brand_release_cache_brand_created
  ON public.two_brand_verified_trading_release_cache
    (brand, created_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_two_brand_release_cache_reference_created
  ON public.two_brand_verified_trading_release_cache
    (brand, reference, dial_color, created_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_two_brand_release_cache_type_created
  ON public.two_brand_verified_trading_release_cache
    (listing_type, brand, created_at DESC NULLS LAST, id DESC);

REVOKE ALL ON public.two_brand_verified_trading_release_cache
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.two_brand_verified_trading_release_cache TO service_role;

COMMENT ON MATERIALIZED VIEW public.two_brand_verified_trading_release_cache IS
  'Service-only customer read cache refreshed after exact four-worker reconciliation; watch_records remains immutable.';

NOTIFY pgrst, 'reload schema';
COMMIT;
