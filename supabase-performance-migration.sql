-- WatchFacts Trading Floor performance migration
-- Run each statement separately in Supabase SQL Editor during a quiet period.
-- CREATE INDEX CONCURRENTLY must not run inside a transaction.
-- This migration only adds indexes; it never changes or deletes listing data.

-- Phase A: required for type-filtered newest-first Trading Floor pages.
-- The live database already has an index on created_at DESC and listing_type
-- independently. This composite index avoids a bitmap scan plus sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_listing_type_created_at_desc
  ON public.watch_records (listing_type, created_at DESC);

ANALYZE public.watch_records;

-- Phase B: enable fast contains search for the existing API query:
-- brand/reference/raw_message ILIKE '%query%'. These indexes can be large on
-- a 2.6M-row archive, so create and measure them one at a time in staging first.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_reference_trgm
  ON public.watch_records USING GIN (reference gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_brand_trgm
  ON public.watch_records USING GIN (brand gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_raw_message_trgm
  ON public.watch_records USING GIN (raw_message gin_trgm_ops);

ANALYZE public.watch_records;

-- Do not drop either MySQL-ID index yet. The live database currently has two
-- indexes on the same expression. Inspect index usage and size first, then
-- remove only the proven redundant index in a separately reviewed migration.
