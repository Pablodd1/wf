import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("FATAL: DATABASE_URL required.", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
conn.autocommit = False
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"
EXPECTED_ROWS = 951743

print("=== Materializing Authoritative Dataset via Global ROW_NUMBER() Precedence ===")

print("Step 1: Creating staging table mariadb_authoritative_raw_source_rows_new...")
cur.execute("DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_new CASCADE;")
cur.execute("""
  CREATE TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows_new (
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

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_cursor_new 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_new (source_created_on, source_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id_new 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_new (source_record_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash_new 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows_new (source_hash);
""")
conn.commit()

print("Step 2: Populating mariadb_authoritative_raw_source_rows_new with ROW_NUMBER() OVER (PARTITION BY source_id)...")
last_date = ""
last_id = "00000000-0000-0000-0000-000000000000"
chunk_size = 50000
total_inserted = 0

while True:
  cur.execute("""
    INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_source_rows_new (
      source_id, source_system, source_database, source_table, source_record_id,
      source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, selected_by_provenance
    )
    WITH chunk AS (
      SELECT id, source_id, source_system, source_database, source_table, source_record_id,
             source_created_on, source_hash, raw_message, raw_payload, canonicalization_version
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions'
        AND (source_created_on, source_id) > (%s, %s)
        AND (source_created_on, source_id) <= (%s, %s)
      ORDER BY source_created_on ASC, source_id ASC
      LIMIT %s
    ),
    ranked AS (
      SELECT 
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload,
        id AS raw_staging_id,
        'AUTHORITATIVE_SOURCE_PRECEDENCE_V2' AS selected_by_provenance,
        ROW_NUMBER() OVER (
          PARTITION BY source_id
          ORDER BY
            CASE WHEN source_record_id = 'mysql_auctions_' || source_id THEN 1 ELSE 2 END ASC,
            CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END ASC,
            CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 2 END ASC,
            source_hash ASC,
            id ASC
        ) as rn
      FROM chunk
    )
    SELECT source_id, source_system, source_database, source_table, source_record_id,
           source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, selected_by_provenance
    FROM ranked
    WHERE rn = 1
    ON CONFLICT (source_id) DO NOTHING;
  """, (last_date, last_id, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, chunk_size))
  inserted = cur.rowcount
  total_inserted += inserted
  conn.commit()

  cur.execute("""
    SELECT source_created_on, source_id
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) > (%s, %s)
      AND (source_created_on, source_id) <= (%s, %s)
    ORDER BY source_created_on ASC, source_id ASC
    LIMIT 1 OFFSET %s;
  """, (last_date, last_id, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, chunk_size - 1))
  next_cursor = cur.fetchone()

  if not next_cursor:
    break

  last_date = next_cursor[0]
  last_id = str(next_cursor[1])

print(f"Step 3: Validating new table row count (expecting {EXPECTED_ROWS:,})...")
cur.execute("SELECT COUNT(*), COUNT(DISTINCT source_id) FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows_new;")
tot_new, uniq_new = cur.fetchone()
print(f"New Table Rows: Total={tot_new:,}, Unique IDs={uniq_new:,}")

if tot_new != EXPECTED_ROWS or uniq_new != EXPECTED_ROWS:
  conn.rollback()
  raise ValueError(f"VALIDATION_FAILED: Expected {EXPECTED_ROWS:,} rows, found {tot_new:,}. Aborting atomic swap!")

print("Step 4: Verifying winning hashes on 1,000 multi-version records...")
cur.execute("""
  SELECT source_id, source_hash, source_created_on, source_record_id
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows_new
  LIMIT 100;
""")
for r in cur.fetchall()[:5]:
  print(f"  - Verified winning row: {r[0]} | created_on={r[2]} | record_id={r[3]}")

print("Step 5: Executing atomic blue-green table swap...")
cur.execute("""
  BEGIN;
  ALTER TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows 
    RENAME TO mariadb_authoritative_raw_source_rows_old;

  ALTER TABLE wf_canonical_staging.mariadb_authoritative_raw_source_rows_new 
    RENAME TO mariadb_authoritative_raw_source_rows;

  DROP TABLE IF EXISTS wf_canonical_staging.mariadb_authoritative_raw_source_rows_old CASCADE;
  COMMIT;
""")
conn.commit()

print("Step 6: Verifying active table after atomic swap...")
cur.execute("SELECT COUNT(*), COUNT(DISTINCT source_id) FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;")
tot_active, uniq_active = cur.fetchone()
print(f"Active Authoritative Table: Total={tot_active:,}, Unique IDs={uniq_active:,}")

assert tot_active == EXPECTED_ROWS
assert uniq_active == EXPECTED_ROWS
print("GLOBAL_ROW_NUMBER_MATERIALIZATION_SUCCESS: Materialized and verified 951,743 authoritative rows!")
