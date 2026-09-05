BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.watch_staging') IS NULL THEN
    RAISE EXCEPTION 'public.watch_staging must exist before hardening';
  END IF;
  IF to_regclass('public.trading_floor_listings') IS NULL THEN
    RAISE EXCEPTION 'public.trading_floor_listings must exist before rebuilding the market view';
  END IF;
END
$$;

ALTER TABLE public.watch_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.watch_staging FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.watch_staging TO service_role;

CREATE OR REPLACE VIEW public.trading_floor_market_listings
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
FROM public.trading_floor_listings
WHERE
  listing_type = 'OTHER'
  OR (
    listing_type IN ('WTS', 'WTB', 'NTQ')
    AND NULLIF(trim(brand), '') IS NOT NULL
    AND upper(trim(brand)) NOT IN ('UNKNOWN', 'N/A', 'NA', 'NULL')
    AND NULLIF(trim(reference), '') IS NOT NULL
    AND upper(trim(reference)) NOT IN ('UNKNOWN', 'N/A', 'NA', 'NULL', '-')
    AND NULLIF(trim(dial_color), '') IS NOT NULL
    AND upper(trim(dial_color)) NOT IN ('UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NULL', '-')
    AND (
      listing_type IN ('WTB', 'NTQ')
      OR (
        listing_type = 'WTS'
        AND price_usd IS NOT NULL
        AND price_usd >= 1000
      )
    )
  );

GRANT SELECT ON public.trading_floor_market_listings TO anon, authenticated;

COMMENT ON VIEW public.trading_floor_market_listings IS
  'Default customer Trading Floor with complete identity and plausible WTS price. Price Research applies its separate catalog model and dial gates in application code.';

NOTIFY pgrst, 'reload schema';
COMMIT;
