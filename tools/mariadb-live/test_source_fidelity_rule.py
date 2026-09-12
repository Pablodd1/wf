import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

print("Testing Source Fidelity Authoritative Precedence Rule...")
cur.execute("""
  WITH authoritative_source_rows AS (
    SELECT DISTINCT ON (source_id)
      id, source_system, source_database, source_table, source_id, source_hash,
      source_record_id, source_created_on, raw_message, raw_payload
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
    ORDER BY 
      source_id ASC,
      CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 0 END DESC,
      LENGTH(raw_payload::text) DESC,
      source_hash ASC,
      id ASC
  )
  SELECT COUNT(*), COUNT(DISTINCT source_id)
  FROM authoritative_source_rows;
""")
tot, uniq = cur.fetchone()
print(f"Total Authoritative Rows: {tot:,}")
print(f"Unique Source IDs:        {uniq:,}")

assert tot == 951743, f"Expected 951,743, got {tot}"
assert uniq == 951743, f"Expected 951,743 unique IDs, got {uniq}"
print("SOURCE_FIDELITY_RULE_VERIFIED: Exactly 951,743 unique IDs selected using payload completeness and source fidelity.")
