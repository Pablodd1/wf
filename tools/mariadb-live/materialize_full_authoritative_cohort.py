import os
import sys
import json
import psycopg2

os.environ["PGTZ"] = "UTC"

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC")
conn.autocommit = False
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

LOWER_DATE = "2025-01-08T13:28:49.000Z"
LOWER_ID = "7534d09b-28b9-4052-8005-228c32f972df"
UPPER_DATE = "2026-08-29T14:42:32.000Z"
UPPER_ID = "f1bdf67a-3723-41c6-a1e3-35c5ca9138b0"
EXPECTED_AUTHORITATIVE_ROWS = 1487325

print("================================================================================")
print("MATERIALIZE FULL AUTHORITATIVE CAPTURE COHORT VIA ATOMIC SWAP")
print("================================================================================\n")

print("Step 1: Creating versioned build table mariadb_authoritative_raw_source_rows_build...")
cur.execute("""
  CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_build CASCADE;
  CREATE TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows_build (
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
    selected_by_provenance TEXT NOT NULL DEFAULT 'AUTHORITATIVE_SOURCE_PRECEDENCE_V2',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_cursor_build 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_build (source_created_on, source_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id_build 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_build (source_record_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash_build 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_build (source_hash);
""")
conn.commit()

print("Step 2: Populating build table via deterministic DISTINCT ON in 16 hex slices...")
cur.execute("SET work_mem = '64MB';")

hex_chars = "0123456789abcdef"
total_inserted = 0

for h in hex_chars:
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_source_rows_build (
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, selected_by_provenance
      )
      SELECT DISTINCT ON (source_id)
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload, id, 'AUTHORITATIVE_SOURCE_PRECEDENCE_V2'
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions'
        AND source_id LIKE %s
        AND (source_created_on > %s OR (source_created_on = %s AND source_id >= %s))
        AND (source_created_on < %s OR (source_created_on = %s AND source_id <= %s))
      ORDER BY 
        source_id ASC,
        CASE WHEN source_record_id = 'mysql_auctions_' || source_id THEN 1 ELSE 2 END ASC,
        CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END ASC,
        CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 2 END ASC,
        source_hash ASC,
        id ASC;
    """, (h + "%", LOWER_DATE, LOWER_DATE, LOWER_ID, UPPER_DATE, UPPER_DATE, UPPER_ID))
    inserted = cur.rowcount
    total_inserted += inserted
    conn.commit()
    print(f"  Slice [{h}]: inserted {inserted:,} rows (total: {total_inserted:,})")

print(f"\nStep 3: Validating build table before atomic swap...")
cur.execute("""
  SELECT COUNT(*), COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows_build;
""")
r = cur.fetchone()
build_count = r[0]
build_distinct = r[1]
print(f"Build Table Metrics: {build_count:,} total rows, {build_distinct:,} distinct source IDs.")

if build_count != EXPECTED_AUTHORITATIVE_ROWS or build_distinct != EXPECTED_AUTHORITATIVE_ROWS:
    raise RuntimeError(f"Validation FAILED before swap: build_count={build_count}, distinct={build_distinct}, expected={EXPECTED_AUTHORITATIVE_ROWS}")

print("Validation PASSED. Executing atomic table swap...")
cur.execute("""
  BEGIN;
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_old CASCADE;
  ALTER TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows RENAME TO mariadb_authoritative_raw_source_rows_old;
  ALTER TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows_build RENAME TO mariadb_authoritative_raw_source_rows;
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_old CASCADE;
  COMMIT;
""")
print("Atomic table swap completed successfully.")

# Step 4: Populate alternate versions table
print("\nStep 4: Re-materializing alternate versions table for auditing...")
cur.execute("""
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions_build CASCADE;
  CREATE TABLE wf_canonical_staging.mariadb_raw_source_alternate_versions_build (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_database TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    source_created_on TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    raw_message TEXT,
    raw_payload JSONB NOT NULL,
    raw_staging_id UUID NOT NULL,
    version_rank INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO wf_canonical_staging.mariadb_raw_source_alternate_versions_build (
    source_id, source_system, source_database, source_table, source_record_id,
    source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, version_rank
  )
  SELECT 
    r.source_id, r.source_system, r.source_database, r.source_table, r.source_record_id,
    r.source_created_on, r.source_hash, r.raw_message, r.raw_payload, r.id,
    2 AS version_rank
  FROM wf_canonical_staging.mariadb_raw_source_rows r
  JOIN wf_canonical_staging.mariadb_authoritative_raw_source_rows a ON a.source_id = r.source_id
  WHERE r.id <> a.raw_staging_id
    AND r.source_system = 'OceanDigital MariaDB'
    AND r.source_database = 'thecollective_inventory'
    AND r.source_table = 'auctions';

  BEGIN;
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions_old CASCADE;
  ALTER TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions RENAME TO mariadb_raw_source_alternate_versions_old;
  ALTER TABLE wf_canonical_staging.mariadb_raw_source_alternate_versions_build RENAME TO mariadb_raw_source_alternate_versions;
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions_old CASCADE;
  COMMIT;
""")
alt_inserted = cur.rowcount
conn.commit()
print(f"Preserved {alt_inserted:,} alternate source versions via atomic swap.")

cur.close()
conn.close()
