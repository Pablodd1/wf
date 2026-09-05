-- Immutable staging area for the 2.30 GB Google Drive CSV export.
-- Imported values remain text/JSON so malformed normalization cannot be
-- silently coerced into the live watch_records contract.

CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE IF NOT EXISTS staging.drive_import_runs (
  source_file_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  rows_seen BIGINT NOT NULL DEFAULT 0,
  rows_inserted BIGINT NOT NULL DEFAULT 0,
  rows_rejected BIGINT NOT NULL DEFAULT 0,
  last_source_row BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS staging.drive_watch_records (
  source_file_id TEXT NOT NULL,
  source_row_number BIGINT NOT NULL,
  source_record_id TEXT,
  row_sha256 TEXT NOT NULL,
  raw_message TEXT,
  brand_claimed TEXT,
  reference_claimed TEXT,
  dial_color_claimed TEXT,
  condition_claimed TEXT,
  year_claimed TEXT,
  price_raw_claimed TEXT,
  price_usd_claimed TEXT,
  currency_claimed TEXT,
  confidence_claimed TEXT,
  verdict_claimed TEXT,
  source_claimed TEXT,
  listing_type_claimed TEXT,
  parser_version_claimed TEXT,
  created_at_claimed TEXT,
  processed_at_claimed TEXT,
  raw_row JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file_id, source_row_number),
  UNIQUE (source_file_id, row_sha256)
);

CREATE INDEX IF NOT EXISTS idx_drive_watch_records_source_record_id
  ON staging.drive_watch_records (source_record_id);

CREATE INDEX IF NOT EXISTS idx_drive_watch_records_reference
  ON staging.drive_watch_records (reference_claimed);

REVOKE ALL ON SCHEMA staging FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA staging FROM anon, authenticated;
GRANT USAGE ON SCHEMA staging TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA staging TO service_role;

