import os
import sys
import json
import subprocess
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
         source_created_on, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '811bbde4-ae03-4367-8a5d-7b250274ed7d';
""")
r = cur.fetchone()
row = {
  "source_id": r[0],
  "source_system": r[1],
  "source_database": r[2],
  "source_table": r[3],
  "source_hash": r[4],
  "source_record_id": r[5],
  "source_created_on": r[6],
  "raw_message": r[7],
  "raw_payload": r[8]
}

worker = subprocess.Popen(
  ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"],
  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"
)
worker.stdin.write(json.dumps([row]) + "\n")
worker.stdin.flush()
line = worker.stdout.readline()
res = json.loads(line)
worker.terminate()

print("Parent keys:", list(res[0]["parent"].keys()))
for c in res[0]["parent"]["children"]:
  print("Child intent:", c.get("intent"), "status:", c.get("trading_floor_status"), "brand:", c.get("brand"), "ref:", c.get("reference"))
