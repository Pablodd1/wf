-- Public Trading Floor read model
--
-- This deliberately exposes only marketplace-safe columns. Raw chat text,
-- seller phone numbers, internal flags, and review metadata remain private.

ALTER TABLE public.watch_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trading_floor_public_read ON public.watch_records;
CREATE POLICY trading_floor_public_read
  ON public.watch_records
  FOR SELECT
  TO anon, authenticated
  USING (
    listing_type IN ('WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER')
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
FROM public.watch_records;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.trading_floor_listings TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
