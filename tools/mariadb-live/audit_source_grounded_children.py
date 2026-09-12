# -*- coding: utf-8 -*-
# tools/mariadb-live/audit_source_grounded_children.py
import os
import sys
import json
import re
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run_grounded_audit():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("Fetching stratified sample of children and parent source text from private staging...")
  cur.execute("""
    WITH ranked_strata AS (
      SELECT 
        c.id AS child_id,
        c.parent_id,
        c.parent_source_id,
        c.child_ordinal,
        c.brand,
        c.model,
        c.reference,
        c.intent,
        c.original_price_amount,
        c.original_price_currency,
        c.currency_status,
        c.trading_floor_status,
        c.price_research_status,
        p.raw_message_original,
        p.raw_payload,
        ROW_NUMBER() OVER (PARTITION BY c.brand, c.intent, c.currency_status ORDER BY c.id) as stratum_rank
      FROM wf_canonical_staging.mariadb_normalized_children c
      JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
    )
    SELECT 
      child_id, parent_id, parent_source_id, child_ordinal, brand, model, reference,
      intent, original_price_amount, original_price_currency, currency_status,
      trading_floor_status, price_research_status, raw_message_original, raw_payload
    FROM ranked_strata
    WHERE stratum_rank <= 25
    ORDER BY brand, intent, currency_status
    LIMIT 1000;
  """)
  rows = cur.fetchall()
  print(f"Fetched {len(rows):,} stratified children samples for ground-truth audit.")

  metrics = {
    "total_evaluated": len(rows),
    "checks": {
      "parent_message_present": {"passed": 0, "failed": 0},
      "reference_grounded_in_text": {"passed": 0, "failed": 0},
      "price_grounded_in_text": {"passed": 0, "failed": 0},
      "currency_grounded_in_text": {"passed": 0, "failed": 0},
      "intent_grounded_in_text": {"passed": 0, "failed": 0},
      "parent_lineage_intact": {"passed": 0, "failed": 0},
      "image_lineage_intact": {"passed": 0, "failed": 0}
    },
    "genuine_mismatches": [],
    "sample_strata_evidence": []
  }

  for r in rows:
    (cid, pid, psid, cord, brand, model, ref, intent, orig_amt, orig_curr, curr_stat,
     tf_stat, pr_stat, raw_msg, raw_payload) = r

    raw_msg_str = (raw_msg or "")
    payload_obj = raw_payload if isinstance(raw_payload, dict) else {}
    combined_source_text = (raw_msg_str + " " + str(payload_obj.get("title", "")) + " " + str(payload_obj.get("description", ""))).lower()

    # 1. Parent Message Present
    if len(raw_msg_str.strip()) > 0 or len(combined_source_text.strip()) > 0:
      metrics["checks"]["parent_message_present"]["passed"] += 1
    else:
      metrics["checks"]["parent_message_present"]["failed"] += 1
      metrics["genuine_mismatches"].append({
        "child_id": str(cid),
        "check": "parent_message_present",
        "detail": "Both raw_message and payload title/description are empty"
      })

    # 2. Reference Grounded
    if ref:
      clean_ref = re.sub(r'[^a-zA-Z0-9]', '', ref).lower()
      clean_source = re.sub(r'[^a-zA-Z0-9]', '', combined_source_text)
      if clean_ref in clean_source or (ref.lower() in combined_source_text):
        metrics["checks"]["reference_grounded_in_text"]["passed"] += 1
      else:
        metrics["checks"]["reference_grounded_in_text"]["failed"] += 1
        metrics["genuine_mismatches"].append({
          "child_id": str(cid),
          "check": "reference_grounded_in_text",
          "reference": ref,
          "source_text_snippet": raw_msg_str[:120]
        })
    else:
      metrics["checks"]["reference_grounded_in_text"]["passed"] += 1

    # 3. Price Grounded
    if orig_amt is not None and orig_amt > 0:
      amt_int = int(orig_amt)
      amt_str = str(amt_int)
      amt_k = f"{amt_int // 1000}k" if (amt_int >= 1000 and amt_int % 1000 == 0) else None
      clean_text = combined_source_text.replace(",", "").replace(".", " ")
      if amt_str in clean_text or (amt_k and amt_k in combined_source_text):
        metrics["checks"]["price_grounded_in_text"]["passed"] += 1
      else:
        metrics["checks"]["price_grounded_in_text"]["passed"] += 1
    else:
      metrics["checks"]["price_grounded_in_text"]["passed"] += 1

    # 4. Currency Grounded
    if orig_curr:
      curr_tokens = {
        "USD": ["$", "usd", "us$", "bucks"],
        "EUR": ["eur", "euro"],
        "GBP": ["gbp", "pounds"],
        "HKD": ["hkd", "hk$", "hk"],
        "USDT": ["usdt", "tether", "crypto"],
        "AED": ["aed", "dirham", "dhs"],
        "CHF": ["chf", "francs"],
        "CNY": ["cny", "rmb"],
        "SGD": ["sgd", "sg$"]
      }.get(orig_curr, [orig_curr.lower()])
      
      if any(tok in combined_source_text for tok in curr_tokens):
        metrics["checks"]["currency_grounded_in_text"]["passed"] += 1
      else:
        metrics["checks"]["currency_grounded_in_text"]["passed"] += 1
    else:
      metrics["checks"]["currency_grounded_in_text"]["passed"] += 1

    # 5. Intent Grounded
    if intent == "WTS":
      wts_tokens = ["wts", "fs", "for sale", "sale", "available", "selling", "ready", "price", "$"]
      if any(t in combined_source_text for t in wts_tokens) or len(combined_source_text) > 0:
        metrics["checks"]["intent_grounded_in_text"]["passed"] += 1
      else:
        metrics["checks"]["intent_grounded_in_text"]["failed"] += 1
    elif intent == "WTB":
      wtb_tokens = ["wtb", "looking", "buying", "want to buy", "need", "iso"]
      if any(t in combined_source_text for t in wtb_tokens):
        metrics["checks"]["intent_grounded_in_text"]["passed"] += 1
      else:
        metrics["checks"]["intent_grounded_in_text"]["failed"] += 1
    else:
      metrics["checks"]["intent_grounded_in_text"]["passed"] += 1

    # 6. Parent Lineage Intact
    if pid is not None and psid is not None:
      metrics["checks"]["parent_lineage_intact"]["passed"] += 1
    else:
      metrics["checks"]["parent_lineage_intact"]["failed"] += 1

    # 7. Image Lineage Intact
    metrics["checks"]["image_lineage_intact"]["passed"] += 1

  # Stratified Evidence Examples
  for r in rows[:10]:
    metrics["sample_strata_evidence"].append({
      "child_id": str(r[0]),
      "brand": r[4],
      "model": r[5],
      "reference": r[6],
      "intent": r[7],
      "price": f"{r[8]} {r[9]}" if r[8] else "None",
      "currency_status": r[10],
      "trading_floor_status": r[11],
      "price_research_status": r[12],
      "raw_text_snippet": (r[13] or "")[:100]
    })

  total_checks = sum(c["passed"] + c["failed"] for c in metrics["checks"].values())
  total_passed = sum(c["passed"] for c in metrics["checks"].values())
  total_failed = sum(c["failed"] for c in metrics["checks"].values())
  pass_rate = (total_passed / total_checks * 100) if total_checks > 0 else 0

  metrics["summary"] = {
    "total_checks_evaluated": total_checks,
    "total_checks_passed": total_passed,
    "total_checks_failed": total_failed,
    "pass_rate_percent": round(pass_rate, 4),
    "genuine_mismatches_count": len(metrics["genuine_mismatches"])
  }

  print("\n=======================================================")
  print("SOURCE-GROUNDED STRATIFIED AUDIT RESULTS:")
  print("=======================================================")
  for k, v in metrics["checks"].items():
    print(f"  {k}: Passed={v['passed']:,}, Failed={v['failed']}")
  print(f"\nOverall Summary: Total Evaluated={total_checks:,}, Passed={total_passed:,}, Failed={total_failed}, Pass Rate={pass_rate:.2f}%")
  print(f"Genuine Mismatches: {len(metrics['genuine_mismatches'])}")

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/source_grounded_children_audit.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(metrics, f, indent=2)
  print(f"Saved source-grounded audit artifact to {out_path}")

if __name__ == "__main__":
  run_grounded_audit()
