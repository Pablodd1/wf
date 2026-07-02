-- ============================================================
-- WatchFacts Batch Ingestion Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Staging table for incoming batch records
CREATE TABLE IF NOT EXISTS watch_staging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL,
    raw_message TEXT,
    brand TEXT,
    reference TEXT,
    dial_color TEXT,
    condition TEXT,
    year INTEGER,
    price_raw NUMERIC,
    price_usd NUMERIC,
    currency TEXT,
    source TEXT DEFAULT 'batch_upload',
    confidence INTEGER DEFAULT 0,
    verdict TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT now(),
    normalized_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    parser_version TEXT DEFAULT 'batch_v1',
    listing_type TEXT DEFAULT 'WTS',
    human_edited BOOLEAN DEFAULT false,
    edit_source TEXT,
    flags JSONB DEFAULT '[]',
    field_confidence JSONB,
    accessories JSONB,
    month_code TEXT,
    image_urls JSONB DEFAULT '[]',
    thumbnail_url TEXT,
    has_images BOOLEAN DEFAULT false
);

-- Index for fast batch lookups
CREATE INDEX IF NOT EXISTS idx_watch_staging_batch_id ON watch_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_watch_staging_verdict ON watch_staging(verdict);
CREATE INDEX IF NOT EXISTS idx_watch_staging_brand ON watch_staging(brand);
CREATE INDEX IF NOT EXISTS idx_watch_staging_reference ON watch_staging(reference);

-- 2. Batch jobs tracking table
CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'normalizing', 'ready', 'published', 'rejected')),
    record_count INTEGER DEFAULT 0,
    approved_count INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    recycle_count INTEGER DEFAULT 0,
    published_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'batch_upload',
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created ON batch_jobs(created_at DESC);

-- 3. Add batch_id to watch_records (if not exists) for traceability
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watch_records' AND column_name = 'batch_id'
    ) THEN
        ALTER TABLE watch_records ADD COLUMN batch_id UUID;
        CREATE INDEX idx_watch_records_batch_id ON watch_records(batch_id);
    END IF;
END $$;

-- 4. Enable RLS (optional — disable if using service_role only)
ALTER TABLE watch_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;

-- Allow all access via service_role (API uses service_role key)
CREATE POLICY "Allow all" ON watch_staging FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON batch_jobs FOR ALL USING (true) WITH CHECK (true);
