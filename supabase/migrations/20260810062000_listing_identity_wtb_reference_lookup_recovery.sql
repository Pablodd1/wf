-- Forward-only recovery for the review-first WTB identity lookup index.
--
-- The original concurrent build can leave an invalid catalog stub when
-- PostgreSQL cannot acquire its brief lock before lock_timeout. The guarded
-- production workflow removes only that exact invalid stub before applying
-- this migration. This file never removes or mutates a valid index or source
-- data.

SET lock_timeout = '120s';
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
