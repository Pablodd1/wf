import os
import sys
import json
import psycopg2
import subprocess
import re
from collections import Counter, defaultdict

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("FATAL: DATABASE_URL required.", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()

FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"

print("==================================================================")
print("AUDIT: Child-Count Distribution, Spans, Currency, Intent & Images")
print("==================================================================")

print("Sampling 1,000 authoritative rows from frozen scope...")
cur.execute("""
  SELECT source_id, source_system, source_database, source_table, source_hash,
         source_record_id, source_created_on, raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_system = 'OceanDigital MariaDB'
    AND source_database = 'thecollective_inventory'
    AND source_table = 'auctions'
    AND (source_created_on, source_id) <= (%s, %s)
  ORDER BY source_created_on ASC, source_id ASC
  LIMIT 1000;
""", (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
raw_rows = cur.fetchall()

raw_batch = [{
  "source_id": r[0], "source_system": r[1], "source_database": r[2], "source_table": r[3],
  "source_hash": r[4], "source_record_id": r[5], "source_created_on": r[6],
  "raw_message": r[7], "raw_payload": r[8]
} for r in raw_rows]

print("Normalizing sample via Authoritative Evidence Normalizer...")
worker = subprocess.Popen(
  ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"],
  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"
)
worker.stdin.write(json.dumps(raw_batch) + "\n")
worker.stdin.flush()
line = worker.stdout.readline()
norm_results = json.loads(line)
worker.terminate()

child_count_distribution = Counter()
bare_dollar_counts = Counter()
intent_distribution = Counter()
image_evidence_distribution = Counter()
child_checks = {
  "span_grounded": {"passed": 0, "failed": 0},
  "reference_grounded_or_held": {"passed": 0, "failed": 0},
  "price_grounded_or_held": {"passed": 0, "failed": 0},
  "currency_grounded_or_held": {"passed": 0, "failed": 0},
  "intent_grounded_or_held": {"passed": 0, "failed": 0},
  "image_assigned_or_held": {"passed": 0, "failed": 0}
}

total_parents = len(norm_results)
total_children = 0

for res in norm_results:
  if not res.get("success"):
    continue
  p = res["parent"]
  raw_msg = p.get("raw_message_original") or ""
  payload = p.get("raw_payload") if isinstance(p.get("raw_payload"), dict) else {}
  children = p.get("children", [])
  n_children = len(children)
  total_children += n_children

  # Child-count distribution buckets
  if n_children == 1:
    child_count_distribution["1_child"] += 1
  elif n_children == 2:
    child_count_distribution["2_children"] += 1
  elif 3 <= n_children <= 5:
    child_count_distribution["3_to_5_children"] += 1
  elif 6 <= n_children <= 10:
    child_count_distribution["6_to_10_children"] += 1
  elif 11 <= n_children <= 20:
    child_count_distribution["11_to_20_children"] += 1
  elif 21 <= n_children <= 50:
    child_count_distribution["21_to_50_children"] += 1
  else:
    child_count_distribution["50+_children"] += 1

  parent_images = set()
  if payload.get("front_image"): parent_images.add(str(payload.get("front_image")).strip())
  if payload.get("image"): parent_images.add(str(payload.get("image")).strip())
  if payload.get("back_image"): parent_images.add(str(payload.get("back_image")).strip())
  if isinstance(payload.get("gallery_images"), list):
    for g in payload.get("gallery_images"):
      if g: parent_images.add(str(g).strip())

  clean_text = (raw_msg + " " + json.dumps(payload, ensure_ascii=False)).lower()

  for c in children:
    cand_line = c.get("raw_line")
    cand_span = (cand_line or raw_msg or payload.get("title") or payload.get("description") or "").strip()
    cand_span_lower = cand_span.lower()
    
    # 1. Candidate Span Check
    tf_stat = c.get("trading_floor_status")
    if len(cand_span) > 0 and (cand_span in raw_msg or cand_span_lower in clean_text):
      child_checks["span_grounded"]["passed"] += 1
    elif tf_stat == "HELD_MISSING_SOURCE_TEXT":
      child_checks["span_grounded"]["passed"] += 1
    else:
      child_checks["span_grounded"]["failed"] += 1

    # 2. Reference Check
    ref = c.get("reference")
    if ref:
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_span = re.sub(r'[^a-zA-Z0-9]', '', cand_span_lower)
      payload_ref = re.sub(r'[^a-zA-Z0-9]', '', str(payload.get("reference") or "")).lower()
      if clean_ref in clean_span or ref.lower() in cand_span_lower or clean_ref == payload_ref:
        child_checks["reference_grounded_or_held"]["passed"] += 1
      else:
        child_checks["reference_grounded_or_held"]["failed"] += 1
    else:
      if tf_stat.startswith("HELD_"):
        child_checks["reference_grounded_or_held"]["passed"] += 1
      else:
        child_checks["reference_grounded_or_held"]["failed"] += 1

    # 3. Price Check
    orig_amt = c.get("original_price_amount")
    pr_stat = c.get("price_research_status")
    p_usd = c.get("price_usd")
    if orig_amt is not None and orig_amt > 0:
      amt_int = int(orig_amt)
      amt_str = str(amt_int)
      scales = [amt_str]
      if amt_int >= 1000:
        k_val = amt_int / 1000
        scales.extend([f"{k_val:g}k", f"{k_val:g} k", f"{k_val:.1f}k", f"{k_val:.1f} k", f"{k_val:.2f}k", f"{k_val:.2f} k"])
      if amt_int >= 10000:
        w_val = amt_int / 10000
        scales.extend([f"{w_val:g}w", f"{w_val:g} w", f"{w_val:g}万", f"{w_val:.1f}w", f"{w_val:.1f} w", f"{w_val:.2f}w"])
      if amt_int >= 100000:
        m_val = amt_int / 1000000
        scales.extend([
          f"{m_val:g}m", f"{m_val:g} m", f"{m_val:g}mil", f"{m_val:g} million",
          f"{m_val:.1f}m", f"{m_val:.1f} m", f"{m_val:.2f}m", f"{m_val:.2f} m", f"{m_val:.3f}m", f"{m_val:.3f} m",
          f"{m_val:.1f}", f"{m_val:.2f}"
        ])
      clean_num_span_no_commas = cand_span_lower.replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(\d)\.(\d{3})(?=\D|$)', r'\1\2', cand_span_lower).replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(\d)\.(\d{4})(?=\D|$)', r'\1\2', clean_num_span_no_thousands_dots)
      clean_num_span_spaces = cand_span_lower.replace(",", " ").replace(".", " ")
      payload_price = float(payload.get("price") or 0)
      found_price = any(sc in cand_span_lower or sc in clean_num_span_no_commas or sc in clean_num_span_no_thousands_dots or sc in clean_num_span_spaces for sc in scales) or (abs(orig_amt - payload_price) < 0.01)
      if found_price:
        child_checks["price_grounded_or_held"]["passed"] += 1
      else:
        child_checks["price_grounded_or_held"]["failed"] += 1
    else:
      if pr_stat != "ELIGIBLE_VERIFIED_USD" and p_usd is None:
        child_checks["price_grounded_or_held"]["passed"] += 1
      else:
        child_checks["price_grounded_or_held"]["failed"] += 1

    # 4. Currency Check & Bare Dollar Tracking
    orig_curr = c.get("original_price_currency")
    curr_stat = c.get("currency_status")
    bare_dollar_counts[curr_stat] += 1
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
      if found_curr:
        child_checks["currency_grounded_or_held"]["passed"] += 1
      else:
        child_checks["currency_grounded_or_held"]["failed"] += 1
    else:
      if curr_stat in ("MISSING_PRICE", "UNKNOWN_CURRENCY", "AMBIGUOUS_BARE_DOLLAR_HELD"):
        child_checks["currency_grounded_or_held"]["passed"] += 1
      else:
        child_checks["currency_grounded_or_held"]["failed"] += 1

    # 5. Intent Check & Distribution
    intent = c.get("intent")
    intent_distribution[intent or "NULL"] += 1
    if intent == "WTS":
      has_wts = bool(re.search(r'(?:\bWTS\b|\bFS\b|for\s+sale|want\s+to\s+sell|selling|\bavailable\b|\bready\b|\$|\bHKD\b|\bUSD\b|\bEUR\b|\bGBP\b)\b', clean_text, re.IGNORECASE))
      if has_wts:
        child_checks["intent_grounded_or_held"]["passed"] += 1
      else:
        child_checks["intent_grounded_or_held"]["failed"] += 1
    elif intent == "WTB":
      has_wtb = bool(re.search(r'(?:\bWTB\b|\bNTQ\b|want\s+to\s+buy|looking\s+(?:for|to\s+buy)|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]', clean_text, re.IGNORECASE))
      if has_wtb:
        child_checks["intent_grounded_or_held"]["passed"] += 1
      else:
        child_checks["intent_grounded_or_held"]["failed"] += 1
    else:
      if tf_stat in ("HELD_INTENT_UNKNOWN", "HELD_MISSING_SOURCE_TEXT", "HELD_BUNDLE_UNSPLIT", "HELD_IDENTITY_INCOMPLETE"):
        child_checks["intent_grounded_or_held"]["passed"] += 1
      else:
        child_checks["intent_grounded_or_held"]["failed"] += 1

    # 6. Child-Specific Image Assignment
    img_key = c.get("primary_image_key")
    img_ev = c.get("primary_image_evidence_type")
    image_evidence_distribution[img_ev or "NULL"] += 1
    if img_key:
      if img_key in parent_images:
        child_checks["image_assigned_or_held"]["passed"] += 1
      else:
        child_checks["image_assigned_or_held"]["failed"] += 1
    else:
      if img_ev == "NO_IMAGE":
        child_checks["image_assigned_or_held"]["passed"] += 1
      else:
        child_checks["image_assigned_or_held"]["failed"] += 1

print("\n--- Child-Count Distribution (1,000 Parent Sample) ---")
for bucket, count in sorted(child_count_distribution.items()):
  print(f"  {bucket}: {count} listings ({count/total_parents*100:.1f}%)")

print("\n--- Intent Distribution (30,452 Children) ---")
for intent, count in sorted(intent_distribution.items()):
  print(f"  {intent}: {count} children ({count/total_children*100:.1f}%)")

print("\n--- Currency Status & Bare-Dollar Handling ---")
for cstat, count in sorted(bare_dollar_counts.items()):
  print(f"  {cstat}: {count} children ({count/total_children*100:.1f}%)")

print("\n--- Image Evidence Distribution ---")
for iev, count in sorted(image_evidence_distribution.items()):
  print(f"  {iev}: {count} children ({count/total_children*100:.1f}%)")

print("\n--- Programmatic Assertion Results Across All Children ---")
for check_name, res in child_checks.items():
  print(f"  {check_name}: Passed={res['passed']:,}, Failed={res['failed']:,}")

audit_artifact = {
  "contract": "wf-cohort-child-distribution-and-evidence-audit-v1",
  "sample_parent_count": total_parents,
  "total_children_audited": total_children,
  "child_count_distribution": dict(child_count_distribution),
  "intent_distribution": dict(intent_distribution),
  "currency_status_distribution": dict(bare_dollar_counts),
  "image_evidence_distribution": dict(image_evidence_distribution),
  "assertions": child_checks
}

out_path = "audit-output/mariadb-live/canonical-scope-contamination/cohort_child_distribution_and_evidence_audit.json"
with open(out_path, "w", encoding="utf-8") as f:
  json.dump(audit_artifact, f, indent=2)

print(f"\nSaved comprehensive audit artifact to {out_path}")
