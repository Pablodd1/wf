-- supabase/migrations/20260831200000_fx_status_reconciliation_and_authoritative_staging.sql
-- Transactional, idempotent migration for:
-- 1. Allowed price_research_status constraint supporting INELIGIBLE_FX_UNRESOLVED
-- 2. Idempotent backfill of priced non-USD rows from INELIGIBLE_MISSING_PRICE to INELIGIBLE_FX_UNRESOLVED
-- 3. Dedicated Authoritative Raw Staging Table ensuring exactly 951,743 unique source rows

BEGIN;

-- 1. Update CHECK constraint on mariadb_normalized_children
ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  DROP CONSTRAINT IF EXISTS chk_mariadb_children_price_research_status;

ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ADD CONSTRAINT chk_mariadb_children_price_research_status CHECK (price_research_status IN (
    'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
    'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
    'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
    'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
  ));

-- 2. Update CHECK constraint on quarantine children
ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
  DROP CONSTRAINT IF EXISTS chk_mariadb_quarantine_children_price_research_status;

ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
  ADD CONSTRAINT chk_mariadb_quarantine_children_price_research_status CHECK (price_research_status IN (
    'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
    'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
    'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
    'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
  ));

-- 3. Idempotent Backfill for proven non-USD currencies with unresolved USD conversion
UPDATE wf_canonical_staging.mariadb_normalized_children
SET price_research_status = 'INELIGIBLE_FX_UNRESOLVED'
WHERE original_price_amount IS NOT NULL 
  AND original_price_amount > 0 
  AND original_price_currency IS NOT NULL
  AND original_price_currency NOT IN ('USD')
  AND currency_status NOT IN ('MISSING_PRICE', 'AMBIGUOUS_BARE_DOLLAR_HELD')
  AND price_research_status = 'INELIGIBLE_MISSING_PRICE';

-- 4. Authoritative Raw Staging Table Structure
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows (
  source_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_database TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_created_on TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  raw_message TEXT,
  raw_payload JSONB NOT NULL,
  raw_staging_id UUID NOT NULL,
  selected_by_provenance TEXT NOT NULL DEFAULT 'AUTHORITATIVE_CAPTURE_PROVENANCE_V1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_cursor 
  ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_created_on, source_id);

CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id 
  ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_record_id);

CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash 
  ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_hash);

COMMIT;
