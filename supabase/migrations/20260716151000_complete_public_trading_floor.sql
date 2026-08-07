-- Customer Trading Floor includes every watch/luxury inventory record except
-- recycle and intentionally hidden/deleted rows. Only marketplace-safe view
-- columns are exposed; raw messages and dealer identifiers remain private.

DROP POLICY IF EXISTS trading_floor_public_read ON public.watch_records;
CREATE POLICY trading_floor_public_read
  ON public.watch_records
  FOR SELECT
  TO anon, authenticated
  USING (
    (
      listing_type IN ('WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER')
      OR reference IS NOT NULL
      OR brand IS NOT NULL
    )
    AND COALESCE(verdict, 'HUMAN') <> 'RECYCLE'
    AND COALESCE(listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
  );

GRANT SELECT ON public.trading_floor_listings TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
