import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

print("Testing Authoritative Version Selection Rule...")
cur.execute("""
  WITH authoritative_raw AS (
    SELECT DISTINCT ON (source_id)
      id, source_system, source_database, source_table, source_id, source_hash,
      source_record_id, source_created_on, created_at
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
    ORDER BY source_id ASC, created_at DESC, id DESC
  )
  SELECT COUNT(*), COUNT(DISTINCT source_id), MIN(source_created_on), MAX(source_created_on)
  FROM authoritative_raw;
""")
tot, uniq, min_c, max_c = cur.fetchone()
print(f"Total Authoritative Rows: {tot:,}")
print(f"Unique Source IDs:        {uniq:,}")
print(f"Min source_created_on:    {min_c}")
print(f"Max source_created_on:    {max_c}")

assert tot == 951743, f"Expected 951,743, got {tot}"
assert uniq == 951743, f"Expected 951,743 unique IDs, got {uniq}"
print("AUTHORITATIVE_VERSION_RULE_VERIFIED: Exactly 951,743 distinct source IDs selected with zero ambiguity.")
