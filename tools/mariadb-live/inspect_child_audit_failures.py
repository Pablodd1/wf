import os
import sys
import json
import psycopg2
import subprocess

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT r.source_id, r.source_system, r.source_database, r.source_table, r.source_hash,
         r.source_record_id, r.source_created_on, r.raw_message, r.raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows r
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

ref_failures = []
curr_failures = []

for res in norm_results:
  if not res.get("success"): continue
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
      import re
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_span = re.sub(r'[^a-zA-Z0-9]', '', cand_span_lower)
      if clean_ref not in clean_span and ref.lower() not in cand_span_lower:
        ref_failures.append({
          "source_id": p.get("source_id"),
          "ref": ref,
          "cand_line": cand_line,
          "cand_span": cand_span[:120],
          "parent_text": raw_msg[:120],
          "payload_title": payload.get("title")
        })

    orig_curr = c.get("original_price_currency")
    curr_stat = c.get("currency_status")
    if orig_curr:
      curr_tokens = {
        "USD": ["$", "usd", "us$", "bucks"],
        "EUR": ["€", "eur", "euro"],
        "GBP": ["£", "gbp", "pounds"],
        "HKD": ["hkd", "hk$", "hk", "hdk", "hkn", "hnk", "港币", "港幣"],
        "USDT": ["usdt", "tether", "crypto"],
        "AED": ["aed", "dirham", "dhs", "dh"],
        "CHF": ["chf", "francs"],
        "CNY": ["cny", "rmb", "¥", "￥"],
        "SGD": ["sgd", "sg$", "s$"]
      }.get(orig_curr, [orig_curr.lower()])
      if not any(tok in cand_span_lower for tok in curr_tokens) and curr_stat != "AMBIGUOUS_BARE_DOLLAR_HELD":
        curr_failures.append({
          "source_id": p.get("source_id"),
          "orig_curr": orig_curr,
          "cand_span": cand_span[:120]
        })

print(f"Total ref failures: {len(ref_failures)}")
for rf in ref_failures[:5]:
  print("Ref failure:", rf)

print(f"\nTotal curr failures: {len(curr_failures)}")
for cf in curr_failures:
  print("Curr failure:", cf)
