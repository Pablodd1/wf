-- Run manually in the production SQL editor outside peak traffic.
-- CONCURRENTLY must not run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_brand_id
  ON public.watch_records (brand, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_reference_created_at
  ON public.watch_records (reference, created_at DESC)
  WHERE reference IS NOT NULL;
