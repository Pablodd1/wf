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
print("MATERIALIZE FULL AUTHORITATIVE CAPTURE COHORT & ALTERNATE VERSIONS")
print("================================================================================\n")

print("Step 1: Re-creating authoritative and alternate version tables...")
cur.execute("""
  CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows CASCADE;
  CREATE TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows (
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

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_cursor 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_created_on, source_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_record_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_hash);

  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions CASCADE;
  CREATE TABLE wf_canonical_staging.mariadb_raw_source_alternate_versions (
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

  CREATE INDEX IF NOT EXISTS idx_mariadb_alternate_source_id 
    ON wf_canonical_staging.mariadb_raw_source_alternate_versions (source_id);
""")
conn.commit()

print("Step 2: Populating authoritative cohort via deterministic DISTINCT ON in 16 hex slices...")
cur.execute("SET work_mem = '64MB';")

hex_chars = "0123456789abcdef"
total_inserted = 0

for h in hex_chars:
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_source_rows (
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

print(f"  Total Inserted Unique Authoritative Rows: {total_inserted:,}")

print(f"\nStep 3: Verifying final authoritative cohort count...")
cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;")
final_count = cur.fetchone()[0]
print(f"Final Authoritative Cohort Count: {final_count:,} (Expected: {EXPECTED_AUTHORITATIVE_ROWS:,})")

if final_count != EXPECTED_AUTHORITATIVE_ROWS:
    print(f"WARNING: Count mismatch {final_count} vs expected {EXPECTED_AUTHORITATIVE_ROWS}", file=sys.stderr)
else:
    print("SUCCESS: Exact 1,487,325 authoritative cohort row count proven.")

# Step 4: Populate alternate versions table
print("\nStep 4: Populating alternate versions table for auditing...")
cur.execute("""
  INSERT INTO wf_canonical_staging.mariadb_raw_source_alternate_versions (
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
""")
alt_inserted = cur.rowcount
conn.commit()
print(f"Preserved {alt_inserted:,} alternate source versions in mariadb_raw_source_alternate_versions.")

cur.close()
conn.close()
