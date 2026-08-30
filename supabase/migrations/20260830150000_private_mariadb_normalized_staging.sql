-- ============================================================================
-- Migration: 20260830150000_private_mariadb_normalized_staging.sql
-- Description: Private Resumable Normalization Staging Schema & Security-Definer Procedures
-- Isolation: Service-role only, strict namespace enforcement, zero public mutations
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

-- 1. Resumable Normalization Checkpoints Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalization_checkpoints (
  job_name TEXT PRIMARY KEY,
  frozen_cursor_created_on TIMESTAMPTZ NOT NULL,
  frozen_cursor_source_id TEXT NOT NULL,
  expected_staged_rows BIGINT NOT NULL DEFAULT 951743,
  last_processed_created_on TIMESTAMPTZ,
  last_processed_source_id TEXT,
  total_inputs_processed BIGINT NOT NULL DEFAULT 0,
  normalized_proposals_count BIGINT NOT NULL DEFAULT 0,
  review_required_count BIGINT NOT NULL DEFAULT 0,
  normalization_errors_count BIGINT NOT NULL DEFAULT 0,
  trading_floor_eligible_count BIGINT NOT NULL DEFAULT 0,
  price_research_eligible_count BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'INITIALIZED',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Normalized Proposals Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalized_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE,
  source_hash TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_database TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_observed_at TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ,
  listing_text_source TEXT,
  listing_text_sha256 TEXT,
  brand TEXT,
  model TEXT,
  reference TEXT,
  dial_color TEXT,
  year INT,
  condition TEXT,
  intent TEXT,
  original_price_amount NUMERIC,
  original_price_currency TEXT,
  currency_evidence TEXT,
  price_usd NUMERIC,
  fx_rate NUMERIC,
  fx_source TEXT,
  fx_date TEXT,
  currency_status TEXT NOT NULL,
  seller_name TEXT,
  seller_contact TEXT,
  contact_publication_approved BOOLEAN NOT NULL DEFAULT FALSE,
  seller_activity_count INT,
  seller_rating NUMERIC,
  seller_rating_status TEXT NOT NULL DEFAULT 'UNRATED_SELLER',
  seller_review_evidence TEXT,
  raw_message TEXT,
  location TEXT,
  image_key TEXT,
  image_url TEXT,
  image_evidence_type TEXT NOT NULL,
  bundle_parent_id TEXT,
  bundle_child_lineage JSONB,
  is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
  trading_floor_status TEXT NOT NULL DEFAULT 'HELD_UNKNOWN',
  trading_floor_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  price_research_status TEXT NOT NULL DEFAULT 'INELIGIBLE_OTHER',
  price_research_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  exclusion_reasons TEXT[] NOT NULL DEFAULT '{}',
  parser_version TEXT NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_brand_ref 
  ON wf_canonical_staging.mariadb_normalized_proposals (brand, reference);
CREATE INDEX IF NOT EXISTS idx_mariadb_norm_tf_eligible 
  ON wf_canonical_staging.mariadb_normalized_proposals (trading_floor_eligible);
CREATE INDEX IF NOT EXISTS idx_mariadb_norm_pr_eligible 
  ON wf_canonical_staging.mariadb_normalized_proposals (price_research_eligible);
CREATE INDEX IF NOT EXISTS idx_mariadb_norm_tf_status 
  ON wf_canonical_staging.mariadb_normalized_proposals (trading_floor_status);
CREATE INDEX IF NOT EXISTS idx_mariadb_norm_pr_status 
  ON wf_canonical_staging.mariadb_normalized_proposals (price_research_status);

-- 3. Staged Rows Keyset Batch Read Procedure with Strict Namespace & Boundary Enforcement
CREATE OR REPLACE FUNCTION public.get_mariadb_private_staged_auctions_batch(
  p_limit INT DEFAULT 1000,
  p_last_created_on TEXT DEFAULT NULL,
  p_last_source_id TEXT DEFAULT NULL,
  p_max_created_on TEXT DEFAULT '2026-04-28T15:50:43.000Z',
  p_max_source_id TEXT DEFAULT '3cddaf9f-9f36-4633-a08e-59a6dfdca057',
  p_source_system TEXT DEFAULT 'OceanDigital MariaDB',
  p_source_database TEXT DEFAULT 'thecollective_inventory',
  p_source_table TEXT DEFAULT 'auctions'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $
DECLARE
  v_res JSONB;
BEGIN
  IF p_last_created_on IS NULL OR p_last_source_id IS NULL THEN
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on < p_max_created_on::timestamptz 
          OR (r.source_created_on = p_max_created_on::timestamptz AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  ELSE
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on > p_last_created_on::timestamptz 
          OR (r.source_created_on = p_last_created_on::timestamptz AND r.source_id > p_last_source_id)
        )
        AND (
          r.source_created_on < p_max_created_on::timestamptz 
          OR (r.source_created_on = p_max_created_on::timestamptz AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  END IF;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$;

REVOKE ALL ON FUNCTION public.get_mariadb_private_staged_auctions_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_private_staged_auctions_batch TO service_role;

-- 4. Batch Ingestion for Normalized Proposals
CREATE OR REPLACE FUNCTION public.upsert_mariadb_normalized_proposals_batch(
  p_proposals JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO wf_canonical_staging.mariadb_normalized_proposals (
    source_id, source_hash, source_system, source_database, source_table,
    source_record_id, source_observed_at, posted_at, listing_text_source, listing_text_sha256,
    brand, model, reference, dial_color, year, condition, intent,
    original_price_amount, original_price_currency, currency_evidence,
    price_usd, fx_rate, fx_source, fx_date, currency_status,
    seller_name, seller_contact, contact_publication_approved,
    seller_activity_count, seller_rating, seller_rating_status, seller_review_evidence,
    raw_message, location, image_key, image_url, image_evidence_type,
    bundle_parent_id, bundle_child_lineage, is_bundle,
    trading_floor_status, trading_floor_eligible,
    price_research_status, price_research_eligible,
    review_flags, exclusion_reasons, parser_version
  )
  SELECT
    (elem->>'source_id')::TEXT,
    (elem->>'source_hash')::TEXT,
    (elem->>'source_system')::TEXT,
    (elem->>'source_database')::TEXT,
    (elem->>'source_table')::TEXT,
    (elem->>'source_record_id')::TEXT,
    (elem->>'source_observed_at')::TIMESTAMPTZ,
    (elem->>'posted_at')::TIMESTAMPTZ,
    (elem->>'listing_text_source')::TEXT,
    (elem->>'listing_text_sha256')::TEXT,
    (elem->>'brand')::TEXT,
    (elem->>'model')::TEXT,
    (elem->>'reference')::TEXT,
    (elem->>'dial_color')::TEXT,
    (elem->>'year')::INT,
    (elem->>'condition')::TEXT,
    (elem->>'intent')::TEXT,
    (elem->>'original_price_amount')::NUMERIC,
    (elem->>'original_price_currency')::TEXT,
    (elem->>'currency_evidence')::TEXT,
    (elem->>'price_usd')::NUMERIC,
    (elem->>'fx_rate')::NUMERIC,
    (elem->>'fx_source')::TEXT,
    (elem->>'fx_date')::TEXT,
    (elem->>'currency_status')::TEXT,
    (elem->>'seller_name')::TEXT,
    (elem->>'seller_contact')::TEXT,
    COALESCE((elem->>'contact_publication_approved')::BOOLEAN, FALSE),
    (elem->>'seller_activity_count')::INT,
    (elem->>'seller_rating')::NUMERIC,
    COALESCE((elem->>'seller_rating_status')::TEXT, 'UNRATED_SELLER'),
    (elem->>'seller_review_evidence')::TEXT,
    (elem->>'raw_message')::TEXT,
    (elem->>'location')::TEXT,
    (elem->>'image_key')::TEXT,
    (elem->>'image_url')::TEXT,
    (elem->>'image_evidence_type')::TEXT,
    (elem->>'bundle_parent_id')::TEXT,
    (elem->'bundle_child_lineage')::JSONB,
    COALESCE((elem->>'is_bundle')::BOOLEAN, FALSE),
    COALESCE((elem->>'trading_floor_status')::TEXT, 'HELD_UNKNOWN'),
    COALESCE((elem->>'trading_floor_eligible')::BOOLEAN, FALSE),
    COALESCE((elem->>'price_research_status')::TEXT, 'INELIGIBLE_OTHER'),
    COALESCE((elem->>'price_research_eligible')::BOOLEAN, FALSE),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'review_flags')), '{}'::TEXT[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'exclusion_reasons')), '{}'::TEXT[]),
    (elem->>'parser_version')::TEXT
  FROM jsonb_array_elements(p_proposals) AS elem
  ON CONFLICT (source_id) DO UPDATE SET
    source_hash = EXCLUDED.source_hash,
    listing_text_source = EXCLUDED.listing_text_source,
    listing_text_sha256 = EXCLUDED.listing_text_sha256,
    brand = EXCLUDED.brand,
    model = EXCLUDED.model,
    reference = EXCLUDED.reference,
    dial_color = EXCLUDED.dial_color,
    year = EXCLUDED.year,
    condition = EXCLUDED.condition,
    intent = EXCLUDED.intent,
    original_price_amount = EXCLUDED.original_price_amount,
    original_price_currency = EXCLUDED.original_price_currency,
    price_usd = EXCLUDED.price_usd,
    currency_status = EXCLUDED.currency_status,
    seller_name = EXCLUDED.seller_name,
    seller_contact = EXCLUDED.seller_contact,
    seller_rating = EXCLUDED.seller_rating,
    seller_rating_status = EXCLUDED.seller_rating_status,
    seller_review_evidence = EXCLUDED.seller_review_evidence,
    image_key = EXCLUDED.image_key,
    image_url = EXCLUDED.image_url,
    image_evidence_type = EXCLUDED.image_evidence_type,
    is_bundle = EXCLUDED.is_bundle,
    trading_floor_status = EXCLUDED.trading_floor_status,
    trading_floor_eligible = EXCLUDED.trading_floor_eligible,
    price_research_status = EXCLUDED.price_research_status,
    price_research_eligible = EXCLUDED.price_research_eligible,
    review_flags = EXCLUDED.review_flags,
    exclusion_reasons = EXCLUDED.exclusion_reasons,
    parser_version = EXCLUDED.parser_version,
    normalized_at = NOW();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('upserted_proposals', v_inserted);
END;
$;

REVOKE ALL ON FUNCTION public.upsert_mariadb_normalized_proposals_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mariadb_normalized_proposals_batch TO service_role;

-- 5. Normalization Checkpoint Management Procedure
CREATE OR REPLACE FUNCTION public.update_mariadb_normalization_checkpoint(
  p_job_name TEXT,
  p_frozen_cursor_created_on TIMESTAMPTZ,
  p_frozen_cursor_source_id TEXT,
  p_last_processed_created_on TIMESTAMPTZ,
  p_last_processed_source_id TEXT,
  p_total_inputs_processed BIGINT,
  p_normalized_proposals_count BIGINT,
  p_review_required_count BIGINT,
  p_normalization_errors_count BIGINT,
  p_trading_floor_eligible_count BIGINT,
  p_price_research_eligible_count BIGINT,
  p_status TEXT,
  p_expected_staged_rows BIGINT DEFAULT 951743
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $
BEGIN
  INSERT INTO wf_canonical_staging.mariadb_normalization_checkpoints (
    job_name, frozen_cursor_created_on, frozen_cursor_source_id, expected_staged_rows,
    last_processed_created_on, last_processed_source_id, total_inputs_processed,
    normalized_proposals_count, review_required_count, normalization_errors_count,
    trading_floor_eligible_count, price_research_eligible_count, status, updated_at
  )
  VALUES (
    p_job_name, p_frozen_cursor_created_on, p_frozen_cursor_source_id, p_expected_staged_rows,
    p_last_processed_created_on, p_last_processed_source_id, p_total_inputs_processed,
    p_normalized_proposals_count, p_review_required_count, p_normalization_errors_count,
    p_trading_floor_eligible_count, p_price_research_eligible_count, p_status, NOW()
  )
  ON CONFLICT (job_name) DO UPDATE SET
    last_processed_created_on = EXCLUDED.last_processed_created_on,
    last_processed_source_id = EXCLUDED.last_processed_source_id,
    total_inputs_processed = EXCLUDED.total_inputs_processed,
    normalized_proposals_count = EXCLUDED.normalized_proposals_count,
    review_required_count = EXCLUDED.review_required_count,
    normalization_errors_count = EXCLUDED.normalization_errors_count,
    trading_floor_eligible_count = EXCLUDED.trading_floor_eligible_count,
    price_research_eligible_count = EXCLUDED.price_research_eligible_count,
    status = EXCLUDED.status,
    updated_at = NOW();

  RETURN jsonb_build_object('checkpoint_updated', TRUE, 'job_name', p_job_name, 'status', p_status);
END;
$;

REVOKE ALL ON FUNCTION public.update_mariadb_normalization_checkpoint FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mariadb_normalization_checkpoint TO service_role;

-- 6. Private Schema Isolation Security Enforcement
REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA wf_canonical_staging TO service_role;

COMMIT;
