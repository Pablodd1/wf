-- Review-first WTB lookup acceleration for Price Research.
--
-- This migration is index-only. It does not approve identities, change
-- listing status, publish contact data, or mutate source evidence.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_listing_identity_wtb_reference_lookup
  ON public.listing_identity_reviews (
    canonical_brand,
    canonical_reference,
    record_id DESC
  )
  WHERE status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED');

ANALYZE public.listing_identity_reviews;

NOTIFY pgrst, 'reload schema';
