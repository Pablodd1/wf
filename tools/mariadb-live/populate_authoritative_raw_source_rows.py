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

print("Step 1: Creating wf_canonical_staging.mariadb_authoritative_raw_source_rows schema...")
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
    selected_by_provenance TEXT NOT NULL DEFAULT 'AUTHORITATIVE_CAPTURE_PROVENANCE_V1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_cursor 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_created_on, source_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_record_id 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_record_id);

  CREATE INDEX IF NOT EXISTS idx_mariadb_auth_raw_hash 
    ON wf_canonical_staging.mariadb_authoritative_raw_source_rows (source_hash);
""")
conn.commit()

print("Step 2: Checking existing row count...")
cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;")
existing_count = cur.fetchone()[0]
print(f"Existing authoritative rows: {existing_count:,}")

if existing_count != 951743:
  print("Step 3: Populating mariadb_authoritative_raw_source_rows in batch chunks using keyset...")
  # Insert with conflict ignore
  # To avoid full table sort timeout, we chunk by source_created_on using keyset cursor
  FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
  FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"

  last_date = ""
  last_id = "00000000-0000-0000-0000-000000000000"
  chunk_size = 50000
  total_inserted = 0

  while True:
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_authoritative_raw_source_rows (
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload, raw_staging_id, selected_by_provenance
      )
      WITH chunk AS (
        SELECT id, source_id, source_system, source_database, source_table, source_record_id,
               source_created_on, source_hash, raw_message, raw_payload
        FROM wf_canonical_staging.mariadb_raw_source_rows
        WHERE source_system = 'OceanDigital MariaDB'
          AND source_database = 'thecollective_inventory'
          AND source_table = 'auctions'
          AND (source_created_on, source_id) > (%s, %s)
          AND (source_created_on, source_id) <= (%s, %s)
        ORDER BY source_created_on ASC, source_id ASC
        LIMIT %s
      ),
      deduped_chunk AS (
        SELECT DISTINCT ON (source_id)
          source_id, source_system, source_database, source_table, source_record_id,
          source_created_on, source_hash, raw_message, raw_payload,
          id AS raw_staging_id,
          'AUTHORITATIVE_CAPTURE_PROVENANCE_V1' AS selected_by_provenance
        FROM chunk
        ORDER BY 
          source_id ASC,
          CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END ASC,
          source_hash ASC,
          id ASC
      )
      SELECT * FROM deduped_chunk
      ON CONFLICT (source_id) DO NOTHING;
    """, (last_date, last_id, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, chunk_size))
    inserted = cur.rowcount
    total_inserted += inserted
    conn.commit()

    # Get the latest cursor from the chunk
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
      print("Reached end of source rows stream.")
      break

    last_date = next_cursor[0]
    last_id = str(next_cursor[1])
    print(f"Processed chunk, total inserted: {total_inserted:,}, current cursor: {last_date} / {last_id}")

print("Step 4: Verifying final authoritative dataset count...")
cur.execute("SELECT COUNT(*), COUNT(DISTINCT source_id) FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;")
tot, uniq = cur.fetchone()
print(f"Authoritative Raw Rows: Total={tot:,}, Unique Source IDs={uniq:,}")

assert tot == 951743, f"Expected 951,743, found {tot}"
assert uniq == 951743, f"Expected 951,743 unique IDs, found {uniq}"
print("VERIFICATION_SUCCESS: mariadb_authoritative_raw_source_rows contains exactly 951,743 rows!")
