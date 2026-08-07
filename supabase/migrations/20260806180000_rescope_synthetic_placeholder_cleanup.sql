-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: Re-Scoped Synthetic Placeholder Cleanup
-- Migration ID: 20260806180000_rescope_synthetic_placeholder_cleanup.sql
-- ============================================================================

-- Re-scope placeholder metric cleanups ONLY to synthetic backfill batches (batch_id = 'canary_500_20260806' or synthetic metadata)
-- Legitimate zero reputation counts and explicit 'Global' locations on non-synthetic records are preserved intact.

UPDATE staging.listings 
SET rating = NULL 
WHERE rating = 0.0 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');

UPDATE staging.listings 
SET dealer_rating = NULL 
WHERE dealer_rating = 0.0 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');

UPDATE staging.listings 
SET review_count = NULL 
WHERE review_count = 0 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');

UPDATE staging.listings 
SET wts_post_count = NULL 
WHERE wts_post_count = 0 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');

UPDATE staging.listings 
SET wtb_post_count = NULL 
WHERE wtb_post_count = 0 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');

UPDATE staging.listings 
SET location = NULL 
WHERE location = 'Global' 
  AND (batch_id = 'canary_500_20260806' OR provenance_metadata::text LIKE '%synthetic%');
