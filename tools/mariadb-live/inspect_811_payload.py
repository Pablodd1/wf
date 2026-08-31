import os
import sys
import json
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT source_id, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '811bbde4-ae03-4367-8a5d-7b250274ed7d';
""")
r = cur.fetchone()
print("Source ID:", r[0])
print("Raw Message:", r[1])
payload = r[2]
print("Payload keys:", list(payload.keys()) if isinstance(payload, dict) else type(payload))
if isinstance(payload, dict):
  desc = payload.get("description") or ""
  comm = payload.get("comments") or ""
  title = payload.get("title") or ""
  print("Title:", title.encode("ascii", "replace").decode("ascii")[:300])
  print("Description:", desc.encode("ascii", "replace").decode("ascii")[:300])
  print("Comments:", comm.encode("ascii", "replace").decode("ascii")[:300])
