-- ==============================================================================
-- Migration: Permanent Ingestion, Extraction, Normalization & Sync Pipeline
-- Timestamp: 2026-08-06T09:00:00Z
-- ==============================================================================

-- 1. SCHEMAS
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS staging;

-- 2. PIPELINE ENUMS
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processing_status' AND typnamespace = 'jobs'::regnamespace) THEN
        CREATE TYPE jobs.processing_status AS ENUM (
            'received', 'queued', 'processing', 'extracted', 'normalized', 
            'validated', 'approved', 'needs_review', 'duplicate', 
            'incomplete', 'rejected', 'failed', 'ignored'
        );
    END IF;
END
$$;

-- 3. RAW PAYLOADS & CHECKSUMS (Immutable Source Logs)
CREATE TABLE IF NOT EXISTS raw.payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_platform VARCHAR(50) NOT NULL,
    source_group_id VARCHAR(100),
    source_group_name VARCHAR(255),
    source_message_id VARCHAR(100) NOT NULL,
    source_sender_id VARCHAR(100),
    source_sender_name VARCHAR(255),
    original_message_text TEXT NOT NULL,
    original_timestamp TIMESTAMPTZ NOT NULL,
    bring_metadata JSONB,
    attachment_metadata JSONB,
    original_image_references TEXT[],
    do_object_key TEXT,
    payload_checksum VARCHAR(64) NOT NULL,
    record_version VARCHAR(20) DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_source_message UNIQUE (source_platform, source_group_id, source_message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_payloads_checksum ON raw.payloads(payload_checksum);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_message_lookup ON raw.payloads(source_platform, source_group_id, source_message_id);

-- 4. PROCESSING JOBS & WORKER COORDINATION
CREATE TABLE IF NOT EXISTS jobs.processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_payload_id UUID REFERENCES raw.payloads(id) ON DELETE CASCADE,
    status jobs.processing_status DEFAULT 'received',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 5,
    last_attempt_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_details TEXT,
    worker_id VARCHAR(100),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    schema_version VARCHAR(20) DEFAULT '1.0',
    extraction_version VARCHAR(20) DEFAULT '1.0',
    normalization_version VARCHAR(20) DEFAULT '1.0',
    validation_version VARCHAR(20) DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs.processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_next_retry ON jobs.processing_jobs(next_retry_at) WHERE status = 'queued';

-- 5. NORMALIZED STAGING TABLES
CREATE TABLE IF NOT EXISTS staging.listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs.processing_jobs(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES staging.listings(id) ON DELETE CASCADE,
    bundle_position INT,
    raw_message_text TEXT NOT NULL,
    category VARCHAR(30) DEFAULT 'WATCH',
    intent VARCHAR(20) DEFAULT 'WTS',
    listing_type VARCHAR(20) DEFAULT 'SINGLE',
    is_bundle BOOLEAN DEFAULT FALSE,
    brand_original VARCHAR(100),
    brand_normalized VARCHAR(100),
    model_original VARCHAR(100),
    model_normalized VARCHAR(100),
    reference_original VARCHAR(100),
    reference_normalized VARCHAR(100),
    dial_color_original VARCHAR(50),
    dial_color_normalized VARCHAR(50),
    dial_color_source VARCHAR(20) DEFAULT 'parsed',
    price_original NUMERIC(15, 2),
    currency_original VARCHAR(10),
    price_normalized NUMERIC(15, 2),
    currency_normalized VARCHAR(10),
    price_usd NUMERIC(15, 2),
    conversion_rate NUMERIC(15, 6),
    conversion_timestamp TIMESTAMPTZ,
    reserve_price NUMERIC(15, 2),
    price_min NUMERIC(15, 2),
    price_max NUMERIC(15, 2),
    price_avg NUMERIC(15, 2),
    price_split_required BOOLEAN DEFAULT FALSE,
    price_history JSONB,
    condition_original VARCHAR(50),
    condition_normalized VARCHAR(50),
    box_original VARCHAR(20),
    box_normalized VARCHAR(10),
    papers_original VARCHAR(20),
    papers_normalized VARCHAR(10),
    image_url TEXT,
    report_url TEXT,
    user_name VARCHAR(150),
    from_name VARCHAR(150),
    contact_number VARCHAR(50),
    from_number VARCHAR(50),
    phone_code VARCHAR(10),
    location VARCHAR(100),
    rating NUMERIC(5,2),
    dealer_rating NUMERIC(5,2),
    is_verified_user BOOLEAN DEFAULT FALSE,
    is_paid_user BOOLEAN DEFAULT FALSE,
    is_seller_approved BOOLEAN DEFAULT FALSE,
    company_id INT,
    contact_consent BOOLEAN DEFAULT FALSE,
    catalog_confirmed BOOLEAN DEFAULT FALSE,
    catalog_canonical_confirmed BOOLEAN DEFAULT FALSE,
    are_attributes_extracted BOOLEAN DEFAULT FALSE,
    identification_status VARCHAR(30),
    wf_inspection BOOLEAN DEFAULT FALSE,
    times_posted INT DEFAULT 1,
    first_posted_at TIMESTAMPTZ,
    reposted_at TIMESTAMPTZ,
    overall_confidence NUMERIC(5,2),
    provenance_metadata JSONB,
    confidence_metrics JSONB,
    validation_errors TEXT[],
    verdict VARCHAR(20) DEFAULT 'approved',
    normalization_status VARCHAR(30) DEFAULT 'normalized',
    trading_floor_status VARCHAR(40) DEFAULT 'published',
    price_research_status VARCHAR(40) DEFAULT 'eligible',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_brand_ref ON staging.listings(brand_normalized, reference_normalized);
CREATE INDEX IF NOT EXISTS idx_staging_intent ON staging.listings(intent);
CREATE INDEX IF NOT EXISTS idx_staging_category ON staging.listings(category);
CREATE INDEX IF NOT EXISTS idx_staging_listing_type ON staging.listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_staging_tf_status ON staging.listings(trading_floor_status);
CREATE INDEX IF NOT EXISTS idx_staging_pr_status ON staging.listings(price_research_status);
CREATE INDEX IF NOT EXISTS idx_staging_norm_status ON staging.listings(normalization_status);
CREATE INDEX IF NOT EXISTS idx_staging_contact ON staging.listings(contact_number);
CREATE INDEX IF NOT EXISTS idx_staging_job_id ON staging.listings(job_id);

-- 6. RECONCILIATION LEDGER
CREATE TABLE IF NOT EXISTS jobs.reconciliation_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_timestamp TIMESTAMPTZ DEFAULT NOW(),
    raw_parents_count INT DEFAULT 0,
    bundle_parents_count INT DEFAULT 0,
    child_listings_count INT DEFAULT 0,
    duplicates_count INT DEFAULT 0,
    failed_jobs_count INT DEFAULT 0,
    priced_count INT DEFAULT 0,
    no_price_count INT DEFAULT 0,
    watches_count INT DEFAULT 0,
    non_watches_count INT DEFAULT 0,
    pr_eligible_count INT DEFAULT 0,
    pr_provisional_count INT DEFAULT 0,
    pr_ineligible_count INT DEFAULT 0,
    reconciliation_details JSONB,
    completed_at TIMESTAMPTZ
);

-- 7. ROW LEVEL SECURITY (RLS) & GRANTS (EXPLICIT TARGETING service_role, anon, authenticated)
ALTER TABLE raw.payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs.reconciliation_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_raw ON raw.payloads;
DROP POLICY IF EXISTS service_role_all_jobs ON jobs.processing_jobs;
DROP POLICY IF EXISTS service_role_all_staging ON staging.listings;
DROP POLICY IF EXISTS service_role_all_ledger ON jobs.reconciliation_ledger;

CREATE POLICY service_role_all_raw ON raw.payloads FOR ALL TO service_role USING (true);
CREATE POLICY service_role_all_jobs ON jobs.processing_jobs FOR ALL TO service_role USING (true);
CREATE POLICY service_role_all_staging ON staging.listings FOR ALL TO service_role USING (true);
CREATE POLICY service_role_all_ledger ON jobs.reconciliation_ledger FOR ALL TO service_role USING (true);

-- 8. UI READ VIEWS MATCHING EXACT APP CONTRACTS

-- View 1: reviewed_workbook_market_source_v2 (Queried by /api/reviewed-market-inventory.js)
CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT 
    id,
    job_id,
    parent_id,
    bundle_position,
    raw_message_text,
    raw_message_text AS message_text,
    raw_message_text AS description,
    category,
    intent,
    listing_type,
    is_bundle,
    brand_normalized AS brand,
    model_normalized AS model,
    reference_normalized AS reference,
    dial_color_normalized AS dial_color,
    condition_normalized AS condition,
    box_normalized AS box,
    papers_normalized AS papers,
    price_usd AS price,
    price_usd,
    currency_normalized AS currency,
    CASE WHEN price_usd = 0 THEN 'Price not supplied' ELSE NULL END AS price_display_label,
    CASE WHEN parent_id IS NULL THEN image_url ELSE '' END AS image_url,
    COALESCE(from_name, user_name) AS seller_name,
    COALESCE(from_name, user_name) AS from_name,
    COALESCE(from_name, user_name) AS user_name,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS seller_contact,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS contact_number,
    location,
    COALESCE(dealer_rating, rating, 0.0) AS dealer_rating,
    COALESCE(dealer_rating, rating, 0.0) AS rating,
    created_at AS posted_at,
    created_at,
    contact_consent,
    verdict,
    normalization_status,
    trading_floor_status,
    price_research_status
FROM staging.listings
WHERE trading_floor_status IN ('published', 'published_pending_verification', 'bundle_pending_separation');

-- View 2: price_research_verified_source (Queried by /api/price-research.js & /api/catalog-references.js)
CREATE OR REPLACE VIEW public.price_research_verified_source AS
SELECT 
    id,
    job_id,
    parent_id,
    bundle_position,
    raw_message_text,
    raw_message_text AS message_text,
    raw_message_text AS description,
    category,
    intent,
    listing_type,
    is_bundle,
    brand_normalized AS brand,
    model_normalized AS model,
    reference_normalized AS reference,
    dial_color_normalized AS dial_color,
    condition_normalized AS condition,
    box_normalized AS box,
    papers_normalized AS papers,
    price_usd AS price,
    price_usd,
    currency_normalized AS currency,
    CASE WHEN parent_id IS NULL THEN image_url ELSE '' END AS image_url,
    COALESCE(from_name, user_name) AS seller_name,
    COALESCE(from_name, user_name) AS from_name,
    CASE WHEN contact_consent = TRUE THEN COALESCE(from_number, contact_number) ELSE NULL END AS seller_contact,
    location,
    COALESCE(dealer_rating, rating, 0.0) AS dealer_rating,
    created_at AS line_date,
    created_at,
    overall_confidence,
    contact_consent,
    verdict,
    normalization_status,
    trading_floor_status,
    price_research_status
FROM staging.listings
WHERE price_research_status = 'eligible';

-- Alias Views for Backward Compatibility
CREATE OR REPLACE VIEW public.trading_floor_view AS SELECT * FROM public.reviewed_workbook_market_source_v2;
CREATE OR REPLACE VIEW public.price_research_view AS SELECT * FROM public.price_research_verified_source;
CREATE OR REPLACE VIEW public.reviewed_workbook_view AS SELECT * FROM public.reviewed_workbook_market_source_v2;

-- Grants for anon and authenticated
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated;
GRANT SELECT ON public.price_research_verified_source TO anon, authenticated;
GRANT SELECT ON public.trading_floor_view TO anon, authenticated;
GRANT SELECT ON public.price_research_view TO anon, authenticated;
GRANT SELECT ON public.reviewed_workbook_view TO anon, authenticated;
