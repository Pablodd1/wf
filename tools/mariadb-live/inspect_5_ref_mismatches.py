import os
import psycopg2
import json
import subprocess
import re

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("""
  SELECT source_id, source_system, source_database, source_table, source_hash,
         source_record_id, source_created_on, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  ORDER BY source_created_on ASC, source_id ASC
  LIMIT 1000;
""")
raw_rows = cur.fetchall()
raw_batch = [{
  "source_id": r[0], "source_system": r[1], "source_database": r[2], "source_table": r[3],
  "source_hash": r[4], "source_record_id": r[5], "source_created_on": r[6],
  "raw_message": r[7], "raw_payload": r[8]
} for r in raw_rows]

worker = subprocess.Popen(
  ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"],
  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"
)
worker.stdin.write(json.dumps(raw_batch) + "\n")
worker.stdin.flush()
line = worker.stdout.readline()
norm_results = json.loads(line)
worker.terminate()

for res in norm_results:
  p = res["parent"]
  raw_msg = p.get("raw_message_original") or ""
  payload = p.get("raw_payload") if isinstance(p.get("raw_payload"), dict) else {}
  for c in p.get("children", []):
    cand_line = c.get("raw_line")
    cand_span = (cand_line or raw_msg or payload.get("title") or payload.get("description") or "").strip()
    cand_span_lower = cand_span.lower()
    ref = c.get("reference")
    tf_stat = c.get("trading_floor_status")
    
    if ref:
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_span = re.sub(r'[^a-zA-Z0-9]', '', cand_span_lower)
      payload_ref = re.sub(r'[^a-zA-Z0-9]', '', str(payload.get("reference") or "")).lower()
      if clean_ref not in clean_span and ref.lower() not in cand_span_lower and clean_ref != payload_ref:
        print("REF MISMATCH:", {
          "source_id": p.get("source_id"),
          "ref": ref,
          "payload_ref": payload.get("reference"),
          "payload_model": payload.get("model"),
          "cand_span": cand_span[:100]
        })
