import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT indexname, indexdef 
  FROM pg_indexes 
  WHERE schemaname = 'wf_canonical_staging' AND tablename = 'mariadb_raw_source_rows';
""")
for r in cur.fetchall():
  print(r[0], "-->", r[1])
