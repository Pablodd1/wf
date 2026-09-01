import os
import sys
import json
import psycopg2
import subprocess

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute("""
  SELECT source_id, source_system, source_database, source_table, source_hash,
         source_record_id, source_created_on, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_created_on::timestamptz <= '2026-04-28T15:50:43.000Z'::timestamptz
  ORDER BY source_created_on::timestamptz ASC, source_id ASC
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

price_failures = []
for res in norm_results:
  if not res.get("success"): continue
  p = res["parent"]
  payload = p.get("raw_payload") or {}
  for c in p.get("children", []):
    orig_amt = c.get("original_price_amount")
    cand_line = c.get("raw_line")
    cand_span = (cand_line or p.get("raw_message_original") or payload.get("title") or payload.get("description") or "").strip()
    if orig_amt is not None and orig_amt > 0:
      amt_str = str(int(orig_amt))
      if amt_str not in cand_span.replace(",", "").replace(".", "") and float(payload.get("price") or 0) != orig_amt:
        price_failures.append({
          "source_id": p.get("source_id"),
          "orig_amt": orig_amt,
          "cand_span": cand_span,
          "payload_price": payload.get("price")
        })

print(f"Total price failures: {len(price_failures)}")
for pf in price_failures:
  print(pf)
