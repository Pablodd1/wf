import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
conn.autocommit = False
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

print("=== Running Authoritative Dataset & FX Status Reconciliation Migration ===")

# 1. Update Check Constraints
print("1. Updating check constraints on children tables...")
cur.execute("""
  ALTER TABLE wf_canonical_staging.mariadb_normalized_children
    DROP CONSTRAINT IF EXISTS chk_mariadb_children_price_research_status;

  ALTER TABLE wf_canonical_staging.mariadb_normalized_children
    ADD CONSTRAINT chk_mariadb_children_price_research_status CHECK (price_research_status IN (
      'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
      'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
      'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
      'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
    ));

  ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
    DROP CONSTRAINT IF EXISTS chk_mariadb_quarantine_children_price_research_status;

  ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
    ADD CONSTRAINT chk_mariadb_quarantine_children_price_research_status CHECK (price_research_status IN (
      'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
      'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
      'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
      'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
    ));
""")

# 2. Reconcile and Backfill 464 rows
print("2. Reconciling priced foreign currency rows...")
cur.execute("""
  SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children
  WHERE original_price_amount IS NOT NULL 
    AND original_price_amount > 0 
    AND price_research_status = 'INELIGIBLE_MISSING_PRICE';
""")
before_count = cur.fetchone()[0]
print(f"   Priced rows with INELIGIBLE_MISSING_PRICE before backfill: {before_count}")

cur.execute("""
  UPDATE wf_canonical_staging.mariadb_normalized_children
  SET price_research_status = 'INELIGIBLE_FX_UNRESOLVED'
  WHERE original_price_amount IS NOT NULL 
    AND original_price_amount > 0 
    AND price_research_status = 'INELIGIBLE_MISSING_PRICE';
""")
updated_count = cur.rowcount
print(f"   Updated rows to INELIGIBLE_FX_UNRESOLVED: {updated_count}")

cur.execute("""
  SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children
  WHERE original_price_amount IS NOT NULL 
    AND original_price_amount > 0 
    AND price_research_status = 'INELIGIBLE_MISSING_PRICE';
""")
after_count = cur.fetchone()[0]
print(f"   Priced rows with INELIGIBLE_MISSING_PRICE after backfill: {after_count}")
assert after_count == 0, f"Expected 0 after backfill, got {after_count}"

# 3. Create Authoritative Deduplicated Dataset Table
print("3. Materializing Authoritative Deduplicated Dataset Table...")
cur.execute("""
  CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_authoritative_raw_rows (
    source_id UUID PRIMARY KEY,
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
    ON wf_canonical_staging.mariadb_authoritative_raw_rows (source_created_on, source_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id 
    ON wf_canonical_staging.mariadb_authoritative_raw_rows (source_record_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash 
    ON wf_canonical_staging.mariadb_authoritative_raw_rows (source_hash);
""")

print("4. Populating Authoritative Deduplicated Dataset from Frozen Scope...")
cur.execute("""
  INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_rows (
    source_id, source_system, source_database, source_table, source_record_id,
    source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, selected_by_provenance
  )
  SELECT DISTINCT ON (source_id)
    source_id,
    source_system,
    source_database,
    source_table,
    source_record_id,
    source_created_on,
    source_hash,
    raw_message,
    raw_payload,
    id AS raw_staging_id,
    'AUTHORITATIVE_CAPTURE_PROVENANCE_V1'
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  ORDER BY 
    source_id ASC,
    CASE WHEN source_created_on LIKE '%T%Z' THEN 1 ELSE 2 END ASC,
    source_hash ASC,
    id ASC
  ON CONFLICT (source_id) DO NOTHING;
""")
inserted_count = cur.rowcount
print(f"   Inserted {inserted_count:,} rows into mariadb_authoritative_raw_rows.")

cur.execute("SELECT COUNT(*), COUNT(DISTINCT source_id) FROM wf_canonical_staging.mariadb_authoritative_raw_rows;")
tot, uniq = cur.fetchone()
print(f"5. Verification: Total Authoritative Rows={tot:,}, Unique Source IDs={uniq:,}")

assert tot == 951743, f"Expected exactly 951,743 rows, found {tot}"
assert uniq == 951743, f"Expected exactly 951,743 unique IDs, found {uniq}"

conn.commit()
print("=== Migration & Authoritative Dataset Table successfully committed! ===")
