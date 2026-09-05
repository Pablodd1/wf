-- ==============================================================================
-- Migration: Immutable Payload Versions & Version-aware Processing Jobs
-- Timestamp: 2026-08-09T00:00:00Z
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS jobs;

-- 1. RAW PAYLOAD VERSIONS (Immutable Version Log)
CREATE TABLE IF NOT EXISTS raw.payload_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_payload_id UUID NOT NULL REFERENCES raw.payloads(id) ON DELETE CASCADE,
    version_checksum VARCHAR(64) NOT NULL UNIQUE,
    original_message_text TEXT NOT NULL,
    original_timestamp TIMESTAMPTZ NOT NULL,
    original_image_references TEXT[],
    do_object_key TEXT,
    attachment_metadata JSONB,
    media_fingerprint TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_payload_version UNIQUE (raw_payload_id, version_checksum)
);

CREATE INDEX IF NOT EXISTS idx_raw_payload_versions_raw_id ON raw.payload_versions(raw_payload_id);
CREATE INDEX IF NOT EXISTS idx_raw_payload_versions_checksum ON raw.payload_versions(version_checksum);

-- 2. ENSURE ALL IMMUTABLE MEDIA COLUMNS EXIST ON VERSIONS TABLE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'raw' AND table_name = 'payload_versions' AND column_name = 'original_image_references'
    ) THEN
        ALTER TABLE raw.payload_versions ADD COLUMN original_image_references TEXT[];
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'raw' AND table_name = 'payload_versions' AND column_name = 'do_object_key'
    ) THEN
        ALTER TABLE raw.payload_versions ADD COLUMN do_object_key TEXT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'raw' AND table_name = 'payload_versions' AND column_name = 'attachment_metadata'
    ) THEN
        ALTER TABLE raw.payload_versions ADD COLUMN attachment_metadata JSONB;
    END IF;
END
$$;

-- 2. PROCESSING JOBS VERSION LINKING
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'jobs' AND table_name = 'processing_jobs' AND column_name = 'payload_version_id'
    ) THEN
        ALTER TABLE jobs.processing_jobs 
        ADD COLUMN payload_version_id UUID REFERENCES raw.payload_versions(id) ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_jobs_payload_version_id ON jobs.processing_jobs(payload_version_id);
