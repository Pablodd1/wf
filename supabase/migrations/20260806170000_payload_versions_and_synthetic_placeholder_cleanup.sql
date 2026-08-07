-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: Immutable Payload Versions & Synthetic Placeholders Cleanup
-- Migration ID: 20260806170000_payload_versions_and_synthetic_placeholder_cleanup.sql
-- ============================================================================

-- 1. CREATE IMMUTABLE PAYLOAD VERSIONS TABLE
CREATE TABLE IF NOT EXISTS raw.payload_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_payload_id UUID REFERENCES raw.payloads(id) ON DELETE CASCADE,
    version_checksum TEXT UNIQUE NOT NULL,
    source_intent TEXT,
    original_message_text TEXT NOT NULL,
    original_timestamp TIMESTAMPTZ,
    batch_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jobs.processing_jobs ADD COLUMN IF NOT EXISTS payload_version_id UUID REFERENCES raw.payload_versions(id) ON DELETE SET NULL;
ALTER TABLE raw.payloads ADD COLUMN IF NOT EXISTS source_intent TEXT;

CREATE INDEX IF NOT EXISTS idx_payload_versions_checksum ON raw.payload_versions(version_checksum);
CREATE INDEX IF NOT EXISTS idx_payload_versions_raw_payload ON raw.payload_versions(raw_payload_id);

-- 2. SCOPED CLEANUP OF DEMONSTRABLY SYNTHETIC/PLACEHOLDER METRICS (CONVERT TO NULL)
UPDATE staging.listings 
SET rating = NULL 
WHERE rating = 0.0;

UPDATE staging.listings 
SET dealer_rating = NULL 
WHERE dealer_rating = 0.0;

UPDATE staging.listings 
SET review_count = NULL 
WHERE review_count = 0;

UPDATE staging.listings 
SET group_count = NULL 
WHERE group_count = 1 AND location = 'Global';

UPDATE staging.listings 
SET wts_post_count = NULL 
WHERE wts_post_count = 0;

UPDATE staging.listings 
SET wtb_post_count = NULL 
WHERE wtb_post_count = 0;

UPDATE staging.listings 
SET location = NULL 
WHERE location = 'Global';
