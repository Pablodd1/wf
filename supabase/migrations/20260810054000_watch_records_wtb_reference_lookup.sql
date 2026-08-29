-- Bounded demand-side lookup acceleration for exact-reference Price Research.
--
-- This migration is index-only. It does not mutate listings, change review
-- decisions, infer identity, alter prices, or publish any new record.
-- PostgreSQL must run CREATE INDEX CONCURRENTLY outside a transaction.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_watch_records_wtb_reference_lookup
  ON public.watch_records (
    brand,
    reference,
    id DESC
  )
  WHERE listing_type IN ('WTB', 'NTQ');

ANALYZE public.watch_records (brand, reference, listing_type);

NOTIFY pgrst, 'reload schema';
