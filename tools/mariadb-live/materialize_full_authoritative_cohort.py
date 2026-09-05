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
print("MATERIALIZE FULL AUTHORITATIVE CAPTURE COHORT VIA ATOMIC REFRESH")
print("================================================================================\n")

print("Step 1: Creating versioned build table mariadb_authoritative_raw_source_rows_build...")
cur.execute("""
  CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_build;
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

print(f"\nStep 3: Validating build table before atomic refresh...")
cur.execute("""
  SELECT COUNT(*), COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows_build;
""")
r = cur.fetchone()
build_count = r[0]
build_distinct = r[1]
print(f"Build Table Metrics: {build_count:,} total rows, {build_distinct:,} distinct source IDs.")

if build_count != EXPECTED_AUTHORITATIVE_ROWS or build_distinct != EXPECTED_AUTHORITATIVE_ROWS:
    raise RuntimeError(f"Validation FAILED before refresh: build_count={build_count}, distinct={build_distinct}, expected={EXPECTED_AUTHORITATIVE_ROWS}")

print("Validation PASSED. Preparing dependency-preserving atomic refresh...")
cur.execute("""
  SELECT c.relkind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'wf_canonical_staging'
    AND c.relname = 'mariadb_authoritative_raw_source_rows';
""")
stable_relation = cur.fetchone()
if not stable_relation or stable_relation[0] not in ("r", "p"):
    raise RuntimeError(
        "Stable authoritative relation must already be a table or partitioned table; "
        "refusing an implicit table-to-view conversion"
    )

cur.execute("""
  SELECT DISTINCT dependent_ns.nspname, dependent.relname
  FROM pg_catalog.pg_depend dependency
  JOIN pg_catalog.pg_rewrite rewrite ON rewrite.oid = dependency.objid
  JOIN pg_catalog.pg_class dependent ON dependent.oid = rewrite.ev_class
  JOIN pg_catalog.pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
  WHERE dependency.refobjid = 'wf_canonical_staging.mariadb_authoritative_raw_source_rows'::regclass
    AND dependent.oid <> dependency.refobjid
  ORDER BY dependent_ns.nspname, dependent.relname;
""")
dependent_views = [f"{schema}.{name}" for schema, name in cur.fetchall()]
print(f"Dependency audit: {len(dependent_views)} attached view(s): {dependent_views}")

cur.execute("""
  SELECT constraint_record.conname, constraint_record.conrelid::regclass::text
  FROM pg_catalog.pg_constraint constraint_record
  WHERE constraint_record.contype = 'f'
    AND constraint_record.confrelid =
      'wf_canonical_staging.mariadb_authoritative_raw_source_rows'::regclass
  ORDER BY constraint_record.conname;
""")
inbound_foreign_keys = cur.fetchall()
if inbound_foreign_keys:
    raise RuntimeError(
        "Stable authoritative table has inbound foreign keys; transactional TRUNCATE "
        f"would require CASCADE and is therefore refused: {inbound_foreign_keys}"
    )

# Preserve the stable table OID so every existing view, function, privilege and
# foreign-key dependency continues to reference the same relation. TRUNCATE and
# INSERT are transactional in PostgreSQL: any validation failure rolls back the
# entire refresh. This intentionally favors dependency safety over zero downtime.
conn.commit()
try:
    cur.execute("LOCK TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows IN ACCESS EXCLUSIVE MODE;")
    cur.execute("TRUNCATE TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows;")
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_source_rows (
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload, raw_staging_id,
        selected_by_provenance, created_at
      )
      SELECT source_id, source_system, source_database, source_table, source_record_id,
             source_created_on, source_hash, raw_message, raw_payload, raw_staging_id,
             selected_by_provenance, created_at
      FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows_build;
    """)
    cur.execute("""
      SELECT COUNT(*), COUNT(DISTINCT source_id)
      FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;
    """)
    refreshed_count, refreshed_distinct = cur.fetchone()
    if refreshed_count != EXPECTED_AUTHORITATIVE_ROWS or refreshed_distinct != EXPECTED_AUTHORITATIVE_ROWS:
        raise RuntimeError(
            f"Stable-table validation failed: count={refreshed_count}, "
            f"distinct={refreshed_distinct}, expected={EXPECTED_AUTHORITATIVE_ROWS}"
        )
    conn.commit()
except Exception:
    conn.rollback()
    raise

print("Dependency-preserving atomic refresh completed successfully.")

# Step 4: Re-materialize alternate versions table
print("\nStep 4: Re-materializing alternate versions table for auditing...")
cur.execute("""
  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_raw_source_alternate_versions_build;
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
  JOIN wf_canonical_staging.mariadb_authoritative_raw_source_rows_active a ON a.source_id = r.source_id
  WHERE r.id <> a.raw_staging_id
    AND r.source_system = 'OceanDigital MariaDB'
    AND r.source_database = 'thecollective_inventory'
    AND r.source_table = 'auctions';

""")
conn.commit()

cur.execute("""
  SELECT c.relkind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'wf_canonical_staging'
    AND c.relname = 'mariadb_raw_source_alternate_versions';
""")
alternate_relation = cur.fetchone()
if not alternate_relation or alternate_relation[0] not in ("r", "p"):
    raise RuntimeError(
        "Stable alternate-version relation must already be a table or partitioned table; "
        "refusing an implicit table-to-view conversion"
    )

cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_raw_source_alternate_versions_build;")
expected_alternate_rows = cur.fetchone()[0]
conn.commit()
try:
    cur.execute("LOCK TABLE wf_canonical_staging.mariadb_raw_source_alternate_versions IN ACCESS EXCLUSIVE MODE;")
    cur.execute("TRUNCATE TABLE wf_canonical_staging.mariadb_raw_source_alternate_versions;")
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_raw_source_alternate_versions (
        id, source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload, raw_staging_id,
        version_rank, created_at
      )
      SELECT id, source_id, source_system, source_database, source_table, source_record_id,
             source_created_on, source_hash, raw_message, raw_payload, raw_staging_id,
             version_rank, created_at
      FROM wf_canonical_staging.mariadb_raw_source_alternate_versions_build;
    """)
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_raw_source_alternate_versions;")
    refreshed_alternate_rows = cur.fetchone()[0]
    if refreshed_alternate_rows != expected_alternate_rows:
        raise RuntimeError(
            f"Alternate-version validation failed: count={refreshed_alternate_rows}, "
            f"expected={expected_alternate_rows}"
        )
    conn.commit()
except Exception:
    conn.rollback()
    raise

print(f"Preserved {expected_alternate_rows:,} alternate source versions via dependency-preserving atomic refresh.")

cur.close()
conn.close()
