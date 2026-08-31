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

# Check total breakdown by created_at date/time for auctions
cur.execute("""
  SELECT date_trunc('hour', created_at), COUNT(*)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
  GROUP BY 1
  ORDER BY 1 ASC;
""")
print("Hourly staging breakdown:")
for r in cur.fetchall():
  print(f"  {r[0]}: {r[1]:,}")

# Check if there are rows staged on Aug 29 (initial raw import) vs Aug 30 (canary / re-runs)
cur.execute("""
  SELECT COUNT(*)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND created_at < '2026-08-30 00:00:00+00';
""")
aug29_count = cur.fetchone()[0]
print(f"Rows staged before Aug 30: {aug29_count:,}")

cur.execute("""
  SELECT COUNT(*)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND created_at >= '2026-08-30 00:00:00+00'
    AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057');
""")
aug30_count = cur.fetchone()[0]
print(f"Rows staged on or after Aug 30 (up to frozen cursor): {aug30_count:,}")

# Let's inspect the exact rows that distinguish the cohort
# Look for all raw rows staged after the initial batch
cur.execute("""
  SELECT source_id, source_hash, source_record_id, source_created_on, created_at, canonicalization_version, raw_sha256
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND created_at < '2026-08-30 00:00:00+00'
  ORDER BY source_created_on ASC, source_id ASC
  LIMIT 5;
""")
print("Sample initial batch rows:")
for r in cur.fetchall():
  print(" ", r)

# Let's check why 951,743 vs 955,743
# Query all distinct created_at intervals
cur.execute("""
  SELECT created_at::date, COUNT(*), MIN(source_created_on), MAX(source_created_on)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
  GROUP BY 1
  ORDER BY 1 ASC;
""")
print("Daily breakdown of raw source rows:")
for r in cur.fetchall():
  print(" ", r)
