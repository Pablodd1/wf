import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

print("1. Tables in wf_canonical_staging:")
cur.execute("""
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'wf_canonical_staging'
  ORDER BY table_name;
""")
for t in cur.fetchall():
  print("  -", t[0])

print("\n2. Checkpoints in wf_canonical_staging.mariadb_normalization_checkpoints:")
try:
  cur.execute("SELECT * FROM wf_canonical_staging.mariadb_normalization_checkpoints;")
  for r in cur.fetchall():
    print(" ", r)
except Exception as e:
  print(" ", e)

print("\n3. Inspecting columns in mariadb_raw_source_rows:")
cur.execute("""
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema = 'wf_canonical_staging' AND table_name = 'mariadb_raw_source_rows'
  ORDER BY ordinal_position;
""")
for c in cur.fetchall():
  print(f"  {c[0]}: {c[1]}")
