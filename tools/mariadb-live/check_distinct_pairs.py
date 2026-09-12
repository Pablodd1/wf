import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

print("Checking distinct (source_created_on, source_id)...")
cur.execute("""
  SELECT COUNT(DISTINCT (source_created_on, source_id)), COUNT(DISTINCT source_id)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057');
""")
r = cur.fetchone()
print(f"Distinct (source_created_on, source_id): {r[0]:,}")
print(f"Distinct source_id:                    {r[1]:,}")

cur.execute("""
  SELECT canonicalization_version, COUNT(*)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  GROUP BY canonicalization_version;
""")
print("\nCanonicalization Versions in scope:")
for row in cur.fetchall():
  print(f"  {row[0]}: {row[1]:,}")
