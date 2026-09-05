-- Protect every new/updated record at the database boundary. NOT VALID avoids
-- blocking deployment if an unknown legacy row violates the historical
-- contract; a separate audited cleanup can precede VALIDATE CONSTRAINT.

ALTER TABLE public.watch_records
  DROP CONSTRAINT IF EXISTS watch_records_confidence_0_100;

ALTER TABLE public.watch_records
  ADD CONSTRAINT watch_records_confidence_0_100
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
  NOT VALID;

COMMENT ON CONSTRAINT watch_records_confidence_0_100 ON public.watch_records IS
  'Enforces the canonical 0-100 confidence contract for new and updated rows.';
