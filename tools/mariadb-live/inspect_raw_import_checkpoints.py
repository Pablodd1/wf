import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

print("1. Inspecting mariadb_raw_import_checkpoints:")
try:
  cur.execute("SELECT * FROM wf_canonical_staging.mariadb_raw_import_checkpoints;")
  for r in cur.fetchall():
    print(" ", r)
except Exception as e:
  print(" ", e)

print("\n2. Inspecting mariadb_raw_import_batches:")
try:
  cur.execute("SELECT id, job_name, source_system, source_table, batch_index, rows_count, status, created_at FROM wf_canonical_staging.mariadb_raw_import_batches LIMIT 10;")
  for r in cur.fetchall():
    print(" ", r)
except Exception as e:
  print(" ", e)
