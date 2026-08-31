import os
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '811bbde4-ae03-4367-8a5d-7b250274ed7d';
""")
r = cur.fetchone()
print("Raw Message:", r[0])
print("Raw Payload:", r[1])
