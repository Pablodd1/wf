-- Align the legacy production constraint with the Trading Floor taxonomy.
ALTER TABLE public.watch_records
  DROP CONSTRAINT IF EXISTS watch_records_listing_type_check;

ALTER TABLE public.watch_records
  ADD CONSTRAINT watch_records_listing_type_check
  CHECK (listing_type IS NULL OR listing_type IN ('WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER'))
  NOT VALID;
