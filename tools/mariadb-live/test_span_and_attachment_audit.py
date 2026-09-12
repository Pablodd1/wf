import os
import sys
import json
import psycopg2
import subprocess
import re

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

total_children = 0
failures = []

for res in norm_results:
  if not res.get("success"): continue
  p = res["parent"]
  raw_msg = p.get("raw_message_original") or ""
  payload = p.get("raw_payload") if isinstance(p.get("raw_payload"), dict) else {}
  
  parent_images = set()
  if payload.get("front_image"): parent_images.add(str(payload.get("front_image")).strip())
  if payload.get("image"): parent_images.add(str(payload.get("image")).strip())
  if payload.get("back_image"): parent_images.add(str(payload.get("back_image")).strip())
  if isinstance(payload.get("gallery_images"), list):
    for g in payload.get("gallery_images"):
      if g: parent_images.add(str(g).strip())

  for c in p.get("children", []):
    total_children += 1
    cand_line = c.get("raw_line")
    cand_span = (cand_line or raw_msg or payload.get("title") or payload.get("description") or "").strip()
    cand_span_lower = cand_span.lower()
    
    # 1. Reference check
    ref = c.get("reference")
    tf_stat = c.get("trading_floor_status")
    if ref:
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_span = re.sub(r'[^a-zA-Z0-9]', '', cand_span_lower)
      payload_ref = re.sub(r'[^a-zA-Z0-9]', '', str(payload.get("reference") or "")).lower()
      if clean_ref not in clean_span and clean_ref != payload_ref:
        failures.append({"source_id": p.get("source_id"), "check": "reference", "ref": ref, "span": cand_span[:60]})
    else:
      if tf_stat not in ("HELD_IDENTITY_INCOMPLETE", "HELD_BUNDLE_UNSPLIT", "HELD_MISSING_SOURCE_TEXT"):
        failures.append({"source_id": p.get("source_id"), "check": "reference_unheld_null", "tf_stat": tf_stat})

    # 2. Price check
    orig_amt = c.get("original_price_amount")
    pr_stat = c.get("price_research_status")
    p_usd = c.get("price_usd")
    if orig_amt is not None and orig_amt > 0:
      amt_int = int(orig_amt)
      amt_str = str(amt_int)
      
      # Scaled variations
      scales = [amt_str]
      if amt_int >= 1000:
        k_val = amt_int / 1000
        scales.extend([
          f"{k_val:g}k", f"{k_val:g} k", f"{k_val:.1f}k", f"{k_val:.1f} k", f"{k_val:.2f}k", f"{k_val:.2f} k",
          f"{k_val:g}".replace(".", ",") + "k", f"{k_val:.1f}".replace(".", ",") + "k"
        ])
      if amt_int >= 10000:
        w_val = amt_int / 10000
        scales.extend([
          f"{w_val:g}w", f"{w_val:g} w", f"{w_val:g}万", f"{w_val:.1f}w", f"{w_val:.1f} w", f"{w_val:.2f}w",
          f"{w_val:g}".replace(".", ",") + "w", f"{w_val:.1f}".replace(".", ",") + "w"
        ])
      if amt_int >= 100000:
        m_val = amt_int / 1000000
        scales.extend([
          f"{m_val:g}m", f"{m_val:g} m", f"{m_val:g}mil", f"{m_val:g} million",
          f"{m_val:.1f}m", f"{m_val:.1f} m", f"{m_val:.2f}m", f"{m_val:.2f} m", f"{m_val:.3f}m", f"{m_val:.3f} m",
          f"{m_val:g}".replace(".", ",") + "m", f"{m_val:g}".replace(".", ",") + " m",
          f"{m_val:.1f}".replace(".", ",") + "m", f"{m_val:.1f}".replace(".", ",") + " m",
          f"{m_val:.2f}".replace(".", ",") + "m", f"{m_val:.2f}".replace(".", ",") + " m",
          f"{m_val:.1f}", f"{m_val:.2f}"
        ])
      
      clean_num_span_no_commas = cand_span_lower.replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(\d)\.(\d{3})(?=\D|$)', r'\1\2', cand_span_lower).replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(\d)\.(\d{4})(?=\D|$)', r'\1\2', clean_num_span_no_thousands_dots) # e.g. 110.0000
      clean_num_span_spaces = cand_span_lower.replace(",", " ").replace(".", " ")
      payload_price = float(payload.get("price") or 0)
      
      found_price = (
        any(
          sc in cand_span_lower or 
          sc in clean_num_span_no_commas or 
          sc in clean_num_span_no_thousands_dots or 
          sc in clean_num_span_spaces 
          for sc in scales
        ) or
        (abs(orig_amt - payload_price) < 0.01)
      )
      if not found_price:
        failures.append({"source_id": p.get("source_id"), "check": "price", "orig_amt": orig_amt, "span": cand_span[:60]})
    else:
      if pr_stat == "ELIGIBLE_VERIFIED_USD" or p_usd is not None:
        failures.append({"source_id": p.get("source_id"), "check": "price_unpriced_eligible", "pr_stat": pr_stat})

    # 3. Currency check
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
        "SGD": ["sgd", "sg$", "s$"],
        "AUD": ["aud", "a$"]
      }.get(orig_curr, [orig_curr.lower()])
      payload_curr = str(payload.get("currency") or "").upper()
      found_curr = any(tok in cand_span_lower for tok in curr_tokens) or (orig_curr == payload_curr) or (curr_stat == "AMBIGUOUS_BARE_DOLLAR_HELD")
      if not found_curr:
        failures.append({"source_id": p.get("source_id"), "check": "currency", "orig_curr": orig_curr, "span": cand_span[:60]})
    else:
      if curr_stat not in ("MISSING_PRICE", "UNKNOWN_CURRENCY", "AMBIGUOUS_BARE_DOLLAR_HELD"):
        failures.append({"source_id": p.get("source_id"), "check": "currency_unheld_null", "curr_stat": curr_stat})

    # 4. Image check
    img_key = c.get("primary_image_key")
    img_ev = c.get("primary_image_evidence_type")
    if img_key:
      if img_key not in parent_images:
        failures.append({"source_id": p.get("source_id"), "check": "image_not_in_attachments", "img_key": img_key})
    else:
      if img_ev != "NO_IMAGE":
        failures.append({"source_id": p.get("source_id"), "check": "image_null_evidence", "img_ev": img_ev})

print(f"Total children tested: {total_children:,}")
print(f"Total failures: {len(failures)}")
if failures:
  for f in failures[:5]:
    safe_f = {k: str(v).encode('ascii', 'replace').decode('ascii') for k, v in f.items()}
    print("Failure:", safe_f)
else:
  print("SUCCESS: 100% of children passed candidate-span and source-attachment audit!")
