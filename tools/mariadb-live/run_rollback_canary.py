# tools/mariadb-live/run_rollback_canary.py
import os
import sys
import json
import time
import subprocess
from datetime import datetime, timezone
import psycopg2

def run_rollback_canary():
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

  print(f"Pre-Canary: Parents={pre_parents:,}, Children={pre_children:,}, Images={pre_images:,}")
  print(f"Public Baseline: Raw Messages={pre_pub_raw:,}, Watch Records={pre_pub_watch:,}")

  print("\n==================================================================")
  print("STAGE 2: Selecting 1,000 Authoritative Rows Strictly Inside Frozen Cohort")
  print("==================================================================")
  cur.execute("""
    WITH authoritative_raw AS (
      SELECT DISTINCT ON (source_id)
        id, source_system, source_database, source_table, source_id, source_hash,
        source_record_id, source_created_on, raw_message, raw_payload, created_at
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions'
        AND (source_created_on, source_id) <= ('2026-04-28T15:50:43.000Z', '3cddaf9f-9f36-4633-a08e-59a6dfdca057')
      ORDER BY source_id ASC, created_at DESC, id DESC
    )
    SELECT source_id, source_system, source_database, source_table, source_hash,
           source_record_id, source_created_on, raw_message, raw_payload
    FROM authoritative_raw
    ORDER BY source_created_on ASC, source_id ASC
    LIMIT 1000;
  """)
  raw_rows = cur.fetchall()
  print(f"Selected {len(raw_rows):,} rows inside frozen cohort.")
  assert len(raw_rows) == 1000, f"Expected 1,000 rows, got {len(raw_rows)}"

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
  print("STAGE 3: Normalizing 1,000 Rows via Authoritative Normalizer")
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

  print(f"Normalized Results: Proposals={proposals_count}, ReviewRequired={review_required_count}, Errors={errors_count}")
  print(f"Eligibility: TradingFloor={tf_eligible_count}, PriceResearch={pr_eligible_count}")

  print("\n==================================================================")
  print("STAGE 4: Executing In-Transaction Upsert & Measuring Uncommitted State")
  print("==================================================================")
  cur.execute("SELECT public.upsert_mariadb_canonical_batch(%s::jsonb);", (json.dumps(parents_to_upsert),))
  rpc_result = cur.fetchone()[0]
  print(f"RPC Upsert Result: {rpc_result}")

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  in_tx_parents = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
  in_tx_children = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  in_tx_images = cur.fetchone()[0]

  print(f"In-Transaction State: Parents={in_tx_parents:,}, Children={in_tx_children:,}, Images={in_tx_images:,}")

  print("\n==================================================================")
  print("STAGE 5: Issuing Explicit ROLLBACK")
  print("==================================================================")
  conn.rollback()
  print("Explicit ROLLBACK executed successfully.")

  print("\n==================================================================")
  print("STAGE 6: Asserting Exact Post-Rollback Zero-Delta Invariants")
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

  assert delta_p == 0, f"Rollback violation: parents changed by {delta_p}"
  assert delta_c == 0, f"Rollback violation: children changed by {delta_c}"
  assert delta_img == 0, f"Rollback violation: images changed by {delta_img}"
  assert delta_raw == 0, f"Rollback violation: public raw_messages changed by {delta_raw}"
  assert delta_watch == 0, f"Rollback violation: public watch_records changed by {delta_watch}"

  report = {
    "contract": "wf-rollback-canary-execution-report-v1",
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
      "parents": in_tx_parents,
      "children": in_tx_children,
      "images": in_tx_images
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
    "rollback_verification": "ZERO_DELTA_CONFIRMED",
    "status": "PASSED"
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/rollback_canary_execution_report.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print(f"\nSaved rollback canary execution report to {out_path}")

if __name__ == "__main__":
  run_rollback_canary()
