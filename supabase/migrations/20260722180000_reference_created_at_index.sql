-- Reference search is ordered by newest listing. A reference-only index still
-- leaves Postgres choosing the created_at index and filtering millions of rows.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_reference_created_at_desc
  ON public.watch_records (reference, created_at DESC, id DESC);

COMMENT ON INDEX public.idx_watch_records_reference_created_at_desc IS
  'Supports bounded Trading Floor reference searches ordered by newest listing.';
