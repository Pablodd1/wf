# tools/mariadb-live/run_authoritative_rollback_canary_and_audit.py
import os
import sys
import json
import subprocess
from datetime import datetime, timezone
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  conn.autocommit = False
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("==================================================================")
  print("STAGE 1: Baseline Measurement Before Rollback Canary")
  print("==================================================================")
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  pre_parents = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
  pre_children = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  pre_images = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pre_pub_raw = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pre_pub_watch = cur.fetchone()[0]

  print(f"Pre-Canary Baseline: Parents={pre_parents:,}, Children={pre_children:,}, Images={pre_images:,}")
  print(f"Public Baseline: Raw Messages={pre_pub_raw:,}, Watch Records={pre_pub_watch:,}")

  print("\n==================================================================")
  print("STAGE 2: Selecting 1,000 Authoritative IDs Absent from Normalized Parents")
  print("==================================================================")
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
  print(f"Selected {len(raw_rows):,} authoritative absent rows.")
  if len(raw_rows) != 1000:
    raise ValueError(f"Expected 1,000 absent rows, found {len(raw_rows)}")

  raw_batch = []
  for r in raw_rows:
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

  print("\n==================================================================")
  print("STAGE 3: Normalizing via Authoritative Normalizer Worker")
  print("==================================================================")
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

  proposals_count = 0
  review_required_count = 0
  errors_count = 0
  tf_eligible_count = 0
  pr_eligible_count = 0
  parents_to_upsert = []

  for res in norm_results:
    if res.get("success"):
      parent = res["parent"]
      parents_to_upsert.append(parent)
      if res.get("is_review_required"):
        review_required_count += 1
      else:
        proposals_count += 1
      for cs in res.get("children_stats", []):
        if cs.get("trading_floor_eligible"): tf_eligible_count += 1
        if cs.get("price_research_eligible"): pr_eligible_count += 1
    else:
      errors_count += 1

  print(f"Normalized: Proposals={proposals_count}, ReviewRequired={review_required_count}, Errors={errors_count}")
  print(f"Eligibility: TradingFloor={tf_eligible_count}, PriceResearch={pr_eligible_count}")

  print("\n==================================================================")
  print("STAGE 4: In-Transaction Upsert & Strict inserted_parents=1000 Assertion")
  print("==================================================================")
  cur.execute("SELECT public.upsert_mariadb_canonical_batch(%s::jsonb);", (json.dumps(parents_to_upsert),))
  rpc_result = cur.fetchone()[0]
  print(f"RPC Upsert Result: {rpc_result}")

  assert rpc_result.get("inserted_parents") == 1000, f"Expected inserted_parents=1000, got {rpc_result.get('inserted_parents')}"
  assert rpc_result.get("updated_parents") == 0, f"Expected updated_parents=0, got {rpc_result.get('updated_parents')}"

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  in_tx_parents = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
  in_tx_children = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  in_tx_images = cur.fetchone()[0]

  in_tx_delta_parents = in_tx_parents - pre_parents
  in_tx_delta_children = in_tx_children - pre_children
  in_tx_delta_images = in_tx_images - pre_images

  print(f"In-Transaction Deltas: Parents=+{in_tx_delta_parents:,}, Children=+{in_tx_delta_children:,}, Images=+{in_tx_delta_images:,}")
  assert in_tx_delta_parents == 1000, f"Expected in-transaction parent delta 1000, got {in_tx_delta_parents}"

  print("\n==================================================================")
  print("\n==================================================================")
  print("STAGE 5: Programmatic Calculated Audit of Exact Canary Children")
  print("==================================================================")
  canary_source_ids = set(r["source_id"] for r in raw_batch)

  # Collect all children produced by the normalizer for these 1,000 parents
  all_canary_children = []
  for p in parents_to_upsert:
    raw_text = p.get("raw_message_original") or ""
    for c in p.get("children", []):
      c_copy = dict(c)
      c_copy["parent_source_id"] = p.get("source_id")
      c_copy["raw_message_original"] = raw_text
      all_canary_children.append(c_copy)

  print(f"Auditing {len(all_canary_children):,} children belonging to the 1,000 canary parent IDs...")

  audit_details = {
    "total_children": len(all_canary_children),
    "checks": {
      "parent_lineage": {"passed": 0, "failed": 0},
      "child_ordinal_valid": {"passed": 0, "failed": 0},
      "price_currency_recognized": {"passed": 0, "failed": 0},
      "cross_field_priced_not_missing": {"passed": 0, "failed": 0},
      "intent_vocabulary_valid": {"passed": 0, "failed": 0},
      "trading_floor_status_valid": {"passed": 0, "failed": 0},
      "price_research_status_valid": {"passed": 0, "failed": 0}
    },
    "failed_samples": []
  }

  for c in all_canary_children:
    psid = c.get("parent_source_id")
    cord = c.get("child_ordinal")
    brand = c.get("brand")
    model = c.get("model")
    ref = c.get("reference")
    intent = c.get("intent")
    orig_amt = c.get("original_price_amount")
    orig_curr = c.get("original_price_currency")
    curr_stat = c.get("currency_status")
    p_usd = c.get("price_usd")
    tf_stat = c.get("trading_floor_status")
    pr_stat = c.get("price_research_status")
    raw_msg = c.get("raw_message_original", "")

    # Check 1: Parent Lineage
    if psid in canary_source_ids:
      audit_details["checks"]["parent_lineage"]["passed"] += 1
    else:
      audit_details["checks"]["parent_lineage"]["failed"] += 1
      audit_details["failed_samples"].append({"source_id": psid, "check": "parent_lineage", "reason": "Parent source ID mismatch"})

    # Check 2: Child Ordinal Valid
    if isinstance(cord, int) and cord >= 0:
      audit_details["checks"]["child_ordinal_valid"]["passed"] += 1
    else:
      audit_details["checks"]["child_ordinal_valid"]["failed"] += 1
      audit_details["failed_samples"].append({"source_id": psid, "check": "child_ordinal_valid", "reason": f"Invalid ordinal {cord}"})

    # Check 3: Price Currency Recognized
    if orig_amt is not None:
      if orig_curr is not None and curr_stat is not None:
        audit_details["checks"]["price_currency_recognized"]["passed"] += 1
      else:
        audit_details["checks"]["price_currency_recognized"]["failed"] += 1
        audit_details["failed_samples"].append({"source_id": psid, "check": "price_currency_recognized", "reason": "Amount present but currency missing"})
    else:
      audit_details["checks"]["price_currency_recognized"]["passed"] += 1

    # Check 4: Cross-Field Rule: Non-Null Price CANNOT be INELIGIBLE_MISSING_PRICE
    if orig_amt is not None and orig_amt > 0:
      if pr_stat == "INELIGIBLE_MISSING_PRICE":
        audit_details["checks"]["cross_field_priced_not_missing"]["failed"] += 1
        audit_details["failed_samples"].append({"source_id": psid, "check": "cross_field_priced_not_missing", "reason": f"Priced row ({orig_amt} {orig_curr}) classified as INELIGIBLE_MISSING_PRICE"})
      else:
        audit_details["checks"]["cross_field_priced_not_missing"]["passed"] += 1
    else:
      audit_details["checks"]["cross_field_priced_not_missing"]["passed"] += 1

    # Check 5: Intent Vocabulary Valid
    if intent in ("WTS", "WTB", None):
      audit_details["checks"]["intent_vocabulary_valid"]["passed"] += 1
    else:
      audit_details["checks"]["intent_vocabulary_valid"]["failed"] += 1
      audit_details["failed_samples"].append({"source_id": psid, "check": "intent_vocabulary_valid", "reason": f"Unknown intent: {intent}"})

    # Check 6: Trading Floor Status Valid
    allowed_tf = {"ELIGIBLE_WTS", "ELIGIBLE_WTB", "HELD_INTENT_UNKNOWN", "HELD_IDENTITY_INCOMPLETE", "HELD_BUNDLE_UNSPLIT"}
    if tf_stat in allowed_tf:
      audit_details["checks"]["trading_floor_status_valid"]["passed"] += 1
    else:
      audit_details["checks"]["trading_floor_status_valid"]["failed"] += 1
      audit_details["failed_samples"].append({"source_id": psid, "check": "trading_floor_status_valid", "reason": f"Disallowed TF status: {tf_stat}"})

    # Check 7: Price Research Status Valid
    allowed_pr = {"ELIGIBLE_VERIFIED_USD", "INELIGIBLE_TRADING_FLOOR_HOLD", "INELIGIBLE_NOT_WTS", "INELIGIBLE_AMBIGUOUS_CURRENCY", "INELIGIBLE_HKD_HELD_FOR_FX", "INELIGIBLE_USDT_HELD_FOR_FX", "INELIGIBLE_FX_UNRESOLVED", "INELIGIBLE_MISSING_PRICE", "INELIGIBLE_IDENTITY_INCOMPLETE", "INELIGIBLE_OUTLIER_EXCLUDED", "INELIGIBLE_OTHER"}
    if pr_stat in allowed_pr:
      audit_details["checks"]["price_research_status_valid"]["passed"] += 1
    else:
      audit_details["checks"]["price_research_status_valid"]["failed"] += 1
      audit_details["failed_samples"].append({"source_id": psid, "check": "price_research_status_valid", "reason": f"Disallowed PR status: {pr_stat}"})

  total_checks_evaluated = sum(c["passed"] + c["failed"] for c in audit_details["checks"].values())
  total_checks_passed = sum(c["passed"] for c in audit_details["checks"].values())
  total_checks_failed = sum(c["failed"] for c in audit_details["checks"].values())
  pass_rate = (total_checks_passed / total_checks_evaluated * 100) if total_checks_evaluated > 0 else 0

  audit_details["summary"] = {
    "total_checks_evaluated": total_checks_evaluated,
    "total_checks_passed": total_checks_passed,
    "total_checks_failed": total_checks_failed,
    "pass_rate_percent": round(pass_rate, 4)
  }

  for k, v in audit_details["checks"].items():
    print(f"  Check '{k}': Passed={v['passed']:,}, Failed={v['failed']}")

  print(f"\nAudit Summary: Evaluated={total_checks_evaluated:,}, Passed={total_checks_passed:,}, Failed={total_checks_failed}, Pass Rate={pass_rate:.2f}%")
  assert total_checks_failed == 0, f"Canary children audit failed {total_checks_failed} checks!"

  print("\n==================================================================")
  print("STAGE 6: Issuing Explicit ROLLBACK")
  print("==================================================================")
  conn.rollback()
  print("Explicit ROLLBACK executed successfully.")

  print("\n==================================================================")
  print("STAGE 7: Post-Rollback Zero-Delta Verification")
  print("==================================================================")
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  post_parents = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
  post_children = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  post_images = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  post_pub_raw = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  post_pub_watch = cur.fetchone()[0]

  delta_p = post_parents - pre_parents
  delta_c = post_children - pre_children
  delta_img = post_images - pre_images
  delta_raw = post_pub_raw - pre_pub_raw
  delta_watch = post_pub_watch - pre_pub_watch

  print(f"Post-Rollback Delta: Parents={delta_p}, Children={delta_c}, Images={delta_img}")
  print(f"Public Tables Delta: RawMessages={delta_raw}, WatchRecords={delta_watch}")

  assert delta_p == 0 and delta_c == 0 and delta_img == 0 and delta_raw == 0 and delta_watch == 0

  report = {
    "contract": "wf-authoritative-rollback-canary-report-v1",
    "executed_at": datetime.now(timezone.utc).isoformat(),
    "inputs_tested": len(raw_rows),
    "normalization_metrics": {
      "normalized_proposals": proposals_count,
      "review_required": review_required_count,
      "technical_errors": errors_count,
      "trading_floor_eligible": tf_eligible_count,
      "price_research_eligible": pr_eligible_count
    },
    "rpc_result": rpc_result,
    "in_transaction_metrics": {
      "delta_parents": in_tx_delta_parents,
      "delta_children": in_tx_delta_children,
      "delta_images": in_tx_delta_images
    },
    "post_rollback_invariants": {
      "parents_before": pre_parents,
      "parents_after": post_parents,
      "delta_parents": delta_p,
      "children_before": pre_children,
      "children_after": post_children,
      "delta_children": delta_c,
      "images_before": pre_images,
      "images_after": post_images,
      "delta_images": delta_img,
      "public_raw_delta": delta_raw,
      "public_watch_delta": delta_watch
    },
    "child_audit_summary": audit_details["summary"],
    "rollback_verification": "ZERO_PERSISTENT_DELTA_CONFIRMED",
    "status": "SUCCESS_VERIFIED"
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/authoritative_rollback_canary_report.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  audit_path = "audit-output/mariadb-live/canonical-scope-contamination/exact_canary_children_calculated_audit.json"
  with open(audit_path, "w", encoding="utf-8") as f:
    json.dump(audit_details, f, indent=2)

  print(f"\nSaved canary report to {out_path}")
  print(f"Saved child audit artifact to {audit_path}")

if __name__ == "__main__":
  run()
