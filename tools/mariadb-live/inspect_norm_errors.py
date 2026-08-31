import os
import sys
import json
import subprocess
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SET statement_timeout = '600s';")

cur.execute("""
  SELECT r.source_id, r.source_system, r.source_database, r.source_table, r.source_hash,
         r.source_record_id, r.source_created_on, r.raw_message, r.raw_payload
  FROM wf_canonical_staging.mariadb_raw_source_rows r
  LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p
    ON r.source_system = p.source_system
   AND r.source_database = p.source_database
   AND r.source_table = p.source_table
   AND r.source_id = p.source_id
  WHERE r.source_system = 'OceanDigital MariaDB'
    AND r.source_database = 'thecollective_inventory'
    AND r.source_table = 'auctions'
    AND (r.source_created_on, r.source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
    AND p.id IS NULL
  ORDER BY r.source_created_on ASC, r.source_id ASC
  LIMIT 1000;
""")
rows = cur.fetchall()

raw_batch = []
for r in rows:
  raw_batch.append({
    "source_id": r[0],
    "source_system": r[1],
    "source_database": r[2],
    "source_table": r[3],
    "source_hash": r[4],
    "source_record_id": r[5],
    "source_created_on": r[6],
    "raw_message": r[7],
    "raw_payload": r[8]
  })

worker_cmd = ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"]
worker = subprocess.Popen(
  worker_cmd,
  stdin=subprocess.PIPE,
  stdout=subprocess.PIPE,
  stderr=subprocess.PIPE,
  text=True,
  encoding="utf-8",
  errors="replace"
)

worker.stdin.write(json.dumps(raw_batch) + "\n")
worker.stdin.flush()
line = worker.stdout.readline()
norm_results = json.loads(line)
worker.terminate()

errors = []
for idx, res in enumerate(norm_results):
  if not res.get("success"):
    errors.append({
      "source_id": raw_batch[idx]["source_id"],
      "error": res.get("error"),
      "raw_message": (raw_batch[idx]["raw_message"] or "")[:100]
    })

print(f"Total errors: {len(errors)}")
for e in errors[:10]:
  print(f"  Source {e['source_id']}: Error={e['error']}")
  print(f"    Raw: {e['raw_message']}")
