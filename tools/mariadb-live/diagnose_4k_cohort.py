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

print("--- mariadb_raw_source_rows columns ---")
cur.execute("""
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema = 'wf_canonical_staging' AND table_name = 'mariadb_raw_source_rows'
  ORDER BY ordinal_position;
""")
cols = cur.fetchall()
for c in cols:
  print(f"  {c[0]} ({c[1]})")

print("\n--- mariadb_raw_import_checkpoints columns ---")
cur.execute("""
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema = 'wf_canonical_staging' AND table_name = 'mariadb_raw_import_checkpoints'
  ORDER BY ordinal_position;
""")
for c in cur.fetchall():
  print(f"  {c[0]} ({c[1]})")

print("\n--- mariadb_raw_import_checkpoints contents ---")
cur.execute("SELECT * FROM wf_canonical_staging.mariadb_raw_import_checkpoints;")
for row in cur.fetchall():
  print(row)

print("\n--- mariadb_raw_source_rows (auctions) time grouping by date_trunc('minute', created_at) ---")
cur.execute("""
  SELECT date_trunc('minute', created_at) AS staged_minute, COUNT(*), MIN(source_created_on), MAX(source_created_on)
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
  GROUP BY 1
  ORDER BY 1 ASC;
""")
for r in cur.fetchall():
  print(f"Staged At: {r[0]} | Count: {r[1]:,} | Min source_created_on: {r[2]} | Max source_created_on: {r[3]}")


