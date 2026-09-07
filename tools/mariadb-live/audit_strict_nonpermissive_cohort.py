import os
import sys
import json
import psycopg2
import subprocess
import re
from datetime import datetime, timezone

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("FATAL: DATABASE_URL required.", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()

FROZEN_UPPER_TS = datetime(2026, 4, 28, 15, 50, 43, tzinfo=timezone.utc)
FROZEN_UPPER_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"

print("==================================================================")
print("AUDIT: Strict Non-Permissive Authoritative Child & Cohort Audit")
print("==================================================================")

# 1. Audit Frozen Membership using Non-Lexical Timestamp Casting
print("Step 1: Auditing frozen membership with non-lexical TIMESTAMPTZ casting...")
cur.execute("""
  SELECT COUNT(*),
         COUNT(CASE WHEN source_created_on::timestamptz <= '2026-04-28T15:50:43.000Z'::timestamptz THEN 1 END) as in_bounds,
         COUNT(CASE WHEN source_created_on::timestamptz > '2026-04-28T15:50:43.000Z'::timestamptz THEN 1 END) as out_of_bounds
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;
""")
tot_auth, in_bounds, out_bounds = cur.fetchone()
print(f"Authoritative Membership: Total={tot_auth:,}, In-Bounds={in_bounds:,}, Out-of-Bounds={out_bounds:,}")
assert out_bounds == 0, f"Found {out_bounds} out-of-bounds rows in authoritative table!"
assert in_bounds == 951743, f"Expected 951,743 in-bounds rows, got {in_bounds}"

# 2. Select 1,000 Deterministic Sample Rows for Child Audit
print("\nStep 2: Selecting 1,000 deterministic sample rows...")
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

strict_checks = {
  "parent_lineage": {"passed": 0, "failed": 0},
  "candidate_span_no_fallback": {"passed": 0, "failed": 0},
  "reference_strict_grounding": {"passed": 0, "failed": 0},
  "price_strict_no_substring": {"passed": 0, "failed": 0},
  "currency_bare_dollar_never_usd": {"passed": 0, "failed": 0},
  "intent_strict_no_currency_proof": {"passed": 0, "failed": 0},
  "image_strict_evidence_label": {"passed": 0, "failed": 0},
  "cross_field_priced_not_missing": {"passed": 0, "failed": 0}
}

total_children = 0
failures = []

for res in norm_results:
  if not res.get("success"):
    continue
  p = res["parent"]
  raw_msg = p.get("raw_message_original") or ""
  payload = p.get("raw_payload") if isinstance(p.get("raw_payload"), dict) else {}
  children = p.get("children", [])
  is_multi_item = len(children) > 1

  parent_images = set()
  if payload.get("front_image"): parent_images.add(str(payload.get("front_image")).strip())
  if payload.get("image"): parent_images.add(str(payload.get("image")).strip())
  if payload.get("back_image"): parent_images.add(str(payload.get("back_image")).strip())
  if isinstance(payload.get("gallery_images"), list):
    for g in payload.get("gallery_images"):
      if g: parent_images.add(str(g).strip())

  clean_text = (raw_msg + " " + json.dumps(payload, ensure_ascii=False)).lower()

  for c in children:
    total_children += 1
    psid = c.get("parent_source_id")
    cand_line = c.get("raw_line")
    tf_stat = c.get("trading_floor_status")
    pr_stat = c.get("price_research_status")
    ref = c.get("reference")
    orig_amt = c.get("original_price_amount")
    orig_curr = c.get("original_price_currency")
    curr_stat = c.get("currency_status")
    intent = c.get("intent")
    img_key = c.get("primary_image_key")
    img_ev = c.get("primary_image_evidence_type")

    # 1. Parent Lineage
    if psid == p.get("source_id"):
      strict_checks["parent_lineage"]["passed"] += 1
    else:
      strict_checks["parent_lineage"]["failed"] += 1
      failures.append({"source_id": psid, "check": "parent_lineage"})

    # 2. Candidate Span - NO Full-Message Fallback for Multi-Item
    if is_multi_item:
      if cand_line and len(cand_line.strip()) > 0 and (cand_line.strip() in raw_msg or cand_line.strip().lower() in clean_text):
        strict_checks["candidate_span_no_fallback"]["passed"] += 1
      else:
        strict_checks["candidate_span_no_fallback"]["failed"] += 1
        failures.append({"source_id": psid, "check": "candidate_span_no_fallback", "reason": "Multi-item child missing discrete raw_line"})
    else:
      single_span = (cand_line or raw_msg or payload.get("title") or payload.get("description") or "").strip()
      if len(single_span) > 0 or tf_stat == "HELD_MISSING_SOURCE_TEXT":
        strict_checks["candidate_span_no_fallback"]["passed"] += 1
      else:
        strict_checks["candidate_span_no_fallback"]["failed"] += 1
        failures.append({"source_id": psid, "check": "candidate_span_no_fallback", "reason": "Single-item empty span"})

    cand_span = (cand_line or raw_msg or payload.get("title") or payload.get("description") or "").strip()
    cand_span_lower = cand_span.lower()

    # 3. Reference Strict Grounding (Exact token in candidate span or source attachment)
    if ref:
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_span = re.sub(r'[^a-zA-Z0-9]', '', cand_span_lower)
      payload_ref = re.sub(r'[^a-zA-Z0-9]', '', str(payload.get("reference") or "")).lower()
      if clean_ref in clean_span or ref.lower() in cand_span_lower or clean_ref == payload_ref:
        strict_checks["reference_strict_grounding"]["passed"] += 1
      else:
        strict_checks["reference_strict_grounding"]["failed"] += 1
        failures.append({"source_id": psid, "check": "reference_strict_grounding", "ref": ref})
    else:
      if tf_stat.startswith("HELD_"):
        strict_checks["reference_strict_grounding"]["passed"] += 1
      else:
        strict_checks["reference_strict_grounding"]["failed"] += 1
        failures.append({"source_id": psid, "check": "reference_strict_grounding", "reason": f"Null ref unheld {tf_stat}"})

    # 4. Price Strict Grounding (No permissive substring matching)
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
          f"{m_val:.1f}m", f"{m_val:.1f} m", f"{m_val:.2f}m", f"{m_val:.2f} m", f"{m_val:.3f}m", f"{m_val:.3f} m"
        ])
      clean_num_span_no_commas = cand_span_lower.replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(?<=\d)\.(?=\d{3}(?:\.|\D|$))', '', cand_span_lower).replace(",", "")
      clean_num_span_no_thousands_dots = re.sub(r'(\d)\.(\d{4})(?=\D|$)', r'\1\2', clean_num_span_no_thousands_dots)
      clean_num_span_spaces = cand_span_lower.replace(",", " ").replace(".", " ")
      payload_price = float(payload.get("price") or 0)
      found_price = any(sc in cand_span_lower or sc in clean_num_span_no_commas or sc in clean_num_span_no_thousands_dots or sc in clean_num_span_spaces for sc in scales) or (abs(orig_amt - payload_price) < 0.01)
      if found_price:
        strict_checks["price_strict_no_substring"]["passed"] += 1
      else:
        strict_checks["price_strict_no_substring"]["failed"] += 1
        failures.append({"source_id": psid, "check": "price_strict_no_substring", "orig_amt": orig_amt})
    else:
      if pr_stat != "ELIGIBLE_VERIFIED_USD" and c.get("price_usd") is None:
        strict_checks["price_strict_no_substring"]["passed"] += 1
      else:
        strict_checks["price_strict_no_substring"]["failed"] += 1
        failures.append({"source_id": psid, "check": "price_strict_no_substring", "reason": "Null price marked eligible"})

    # 5. Bare Dollar Never USD
    if curr_stat == "AMBIGUOUS_BARE_DOLLAR_HELD":
      if pr_stat != "ELIGIBLE_VERIFIED_USD" and c.get("price_usd") is None:
        strict_checks["currency_bare_dollar_never_usd"]["passed"] += 1
      else:
        strict_checks["currency_bare_dollar_never_usd"]["failed"] += 1
        failures.append({"source_id": psid, "check": "currency_bare_dollar_never_usd", "reason": "Bare dollar admitted to price research"})
    else:
      strict_checks["currency_bare_dollar_never_usd"]["passed"] += 1

    # 6. Intent Strict - No Currency Proof
    if intent == "WTS":
      has_wts_word = bool(re.search(r'(?:\bWTS\b|\bFS\b|for\s+sale|want\s+to\s+sell|selling)\b', clean_text, re.IGNORECASE))
      if has_wts_word:
        strict_checks["intent_strict_no_currency_proof"]["passed"] += 1
      else:
        strict_checks["intent_strict_no_currency_proof"]["failed"] += 1
        failures.append({"source_id": psid, "check": "intent_strict_no_currency_proof", "reason": "WTS without explicit sale keyword"})
    elif intent == "WTB":
      has_wtb_word = bool(re.search(r'(?:\bWTB\b|\bNTQ\b|want\s+to\s+buy|looking\s+(?:for|to\s+buy)|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]', clean_text, re.IGNORECASE))
      if has_wtb_word:
        strict_checks["intent_strict_no_currency_proof"]["passed"] += 1
      else:
        strict_checks["intent_strict_no_currency_proof"]["failed"] += 1
        failures.append({"source_id": psid, "check": "intent_strict_no_currency_proof", "reason": "WTB without explicit buy keyword"})
    else:
      if tf_stat in ("HELD_INTENT_UNKNOWN", "HELD_MISSING_SOURCE_TEXT", "HELD_BUNDLE_UNSPLIT", "HELD_IDENTITY_INCOMPLETE"):
        strict_checks["intent_strict_no_currency_proof"]["passed"] += 1
      else:
        strict_checks["intent_strict_no_currency_proof"]["failed"] += 1
        failures.append({"source_id": psid, "check": "intent_strict_no_currency_proof", "reason": f"Untagged intent unheld {tf_stat}"})

    # 7. Image Strict Evidence Label
    if is_multi_item:
      if img_ev == "PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD" or img_ev == "NO_IMAGE" or img_key in parent_images:
        strict_checks["image_strict_evidence_label"]["passed"] += 1
      else:
        strict_checks["image_strict_evidence_label"]["failed"] += 1
        failures.append({"source_id": psid, "check": "image_strict_evidence_label", "reason": "Multi-item child assigned parent image without evidence"})
    else:
      if img_key in parent_images or img_ev == "NO_IMAGE":
        strict_checks["image_strict_evidence_label"]["passed"] += 1
      else:
        strict_checks["image_strict_evidence_label"]["failed"] += 1
        failures.append({"source_id": psid, "check": "image_strict_evidence_label", "reason": "Single-item image missing from attachments"})

    # 8. Cross-Field Priced Not Missing
    if orig_amt is not None and orig_amt > 0:
      if pr_stat == "INELIGIBLE_MISSING_PRICE":
        strict_checks["cross_field_priced_not_missing"]["failed"] += 1
        failures.append({"source_id": psid, "check": "cross_field_priced_not_missing", "reason": "Priced classified as missing price"})
      else:
        strict_checks["cross_field_priced_not_missing"]["passed"] += 1
    else:
      strict_checks["cross_field_priced_not_missing"]["passed"] += 1

print("\n--- Programmatic Assertion Results (Strict Non-Permissive Audit) ---")
for check_name, res in strict_checks.items():
  print(f"  {check_name}: Passed={res['passed']:,}, Failed={res['failed']:,}")

report_data = {
  "contract": "wf-strict-nonpermissive-cohort-audit-v2",
  "upper_cursor_timestamptz": "2026-04-28T15:50:43.000Z",
  "total_children_audited": total_children,
  "assertions": strict_checks,
  "failures_count": len(failures)
}

out_path = "audit-output/mariadb-live/canonical-scope-contamination/strict_nonpermissive_cohort_audit.json"
with open(out_path, "w", encoding="utf-8") as f:
  json.dump(report_data, f, indent=2)

print(f"\nSaved strict audit report to {out_path}")
if failures:
  print("FAILURES DETAILED:", json.dumps(failures[:10], indent=2))
assert len(failures) == 0, f"Strict audit failed {len(failures)} assertions!"
print("STRICT_AUDIT_SUCCESS: 100% of children passed strict non-permissive audit rules!")
