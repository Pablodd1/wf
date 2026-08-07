-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: Batch ID, Version Checksum, Schema Defaults Cleanup
-- Migration ID: 20260806160000_batch_id_and_schema_defaults_cleanup.sql
-- ============================================================================

-- 1. ADD BATCH_ID AND VERSION_CHECKSUM COLUMNS
ALTER TABLE raw.payloads ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE raw.payloads ADD COLUMN IF NOT EXISTS version_checksum TEXT;

ALTER TABLE jobs.processing_jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;

ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS batch_id TEXT;

-- 2. CREATE INDEXES FOR FAST BATCH-SCOPED AND VERSION LOOKUPS
CREATE INDEX IF NOT EXISTS idx_raw_payloads_batch_id ON raw.payloads(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_version_checksum ON raw.payloads(version_checksum);
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs.processing_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_listings_batch_id ON staging.listings(batch_id);

-- 3. BACKFILL IMMUTABLE CANARY BATCH ID
UPDATE raw.payloads 
SET batch_id = 'canary_500_20260806' 
WHERE source_group_name IN ('Asia', 'North America', 'Europe', 'Africa');

UPDATE jobs.processing_jobs 
SET batch_id = 'canary_500_20260806' 
WHERE raw_payload_id IN (
    SELECT id FROM raw.payloads WHERE batch_id = 'canary_500_20260806'
);

UPDATE staging.listings 
SET batch_id = 'canary_500_20260806' 
WHERE job_id IN (
    SELECT id FROM jobs.processing_jobs WHERE batch_id = 'canary_500_20260806'
);

-- 4. DROP INVENTED SCHEMA COLUMN DEFAULTS (PRESERVE MISSING METRICS AS NULL)
ALTER TABLE staging.listings ALTER COLUMN rating DROP DEFAULT;
ALTER TABLE staging.listings ALTER COLUMN dealer_rating DROP DEFAULT;
ALTER TABLE staging.listings ALTER COLUMN review_count DROP DEFAULT;
ALTER TABLE staging.listings ALTER COLUMN group_count DROP DEFAULT;
ALTER TABLE staging.listings ALTER COLUMN wts_post_count DROP DEFAULT;
ALTER TABLE staging.listings ALTER COLUMN wtb_post_count DROP DEFAULT;
