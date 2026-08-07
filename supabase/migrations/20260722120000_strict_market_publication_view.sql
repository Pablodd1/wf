-- Strict customer-market read model.
--
-- Keep trading_floor_listings as the complete customer-safe archive. The
-- default marketplace uses this narrower view so incomplete normalization
-- cannot consume page slots or inflate its totals. Model confirmation remains
-- a separate catalog gate because watch_records does not persist model yet.

CREATE OR REPLACE VIEW public.trading_floor_market_listings
WITH (security_invoker = true) AS
SELECT *
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
  'Default customer market: complete watch identity, WTS price >= USD 1,000, WTB price optional; full safe history remains in trading_floor_listings.';

NOTIFY pgrst, 'reload schema';
