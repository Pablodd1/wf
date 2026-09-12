import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"

print("Checking source snapshot matching count...")
cur.execute("""
  SELECT COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= (%s, %s)
    AND source_record_id = 'mysql_auctions_' || source_id
    AND raw_payload->>'created_on' LIKE '%%T%%Z'
    AND source_created_on = raw_payload->>'created_on';
""", (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
cnt = cur.fetchone()[0]
print(f"Distinct source IDs with exact authoritative source snapshot match: {cnt:,}")

print("Checking total unique source IDs in frozen scope...")
cur.execute("""
  SELECT COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= (%s, %s);
""", (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
total_uniq = cur.fetchone()[0]
print(f"Total unique source IDs in scope: {total_uniq:,}")
