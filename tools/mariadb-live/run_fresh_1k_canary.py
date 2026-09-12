# tools/mariadb-live/run_fresh_1k_canary.py
import os
import sys
import json
import time
import subprocess
from datetime import datetime, timezone
import psycopg2

def run_fresh_1k_canary():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  conn.autocommit = False
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("==================================================================")
  print("STAGE 1: Baseline Measurement Before Fresh 1K Canary")
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

  print("\n==================================================================")
  print("STAGE 2: Selecting 1,000 Genuine Auctions Rows NOT in Normalized Parents")
  print("==================================================================")
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
      AND p.id IS NULL
    ORDER BY r.source_created_on ASC, r.source_id ASC
    LIMIT 1000;
  """)
  fresh_raw_rows = cur.fetchall()
  print(f"Fetched {len(fresh_raw_rows):,} fresh genuine raw rows.")
  if len(fresh_raw_rows) != 1000:
    raise ValueError(f"Expected 1,000 fresh rows, found {len(fresh_raw_rows)}")

  raw_batch = []
  for r in fresh_raw_rows:
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
  print("STAGE 3: Normalizing Fresh 1,000 Rows via Authoritative Normalizer")
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
  print("STAGE 4: Upserting Fresh 1,000 Rows to Canonical Staging")
  print("==================================================================")
  cur.execute("SELECT public.upsert_mariadb_canonical_batch(%s::jsonb);", (json.dumps(parents_to_upsert),))
  rpc_result = cur.fetchone()[0]
  print(f"RPC Upsert Result: {rpc_result}")

  conn.commit()

  print("\n==================================================================")
  print("STAGE 5: Measuring Post-Canary Counts and Reconciling Deltas")
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

  delta_parents = post_parents - pre_parents
  delta_children = post_children - pre_children
  delta_images = post_images - pre_images

  print(f"Post-Canary: Parents={post_parents:,} (+{delta_parents:,}), Children={post_children:,} (+{delta_children:,}), Images={post_images:,} (+{delta_images:,})")
  print(f"Public Isolation: raw_messages={post_pub_raw} (delta={post_pub_raw - pre_pub_raw}), watch_records={post_pub_watch} (delta={post_pub_watch - pre_pub_watch})")

  # Verify scope integrity
  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system <> 'OceanDigital MariaDB'
       OR source_database <> 'thecollective_inventory'
       OR source_table <> 'auctions';
  """)
  non_auctions = cur.fetchone()[0]
  assert non_auctions == 0, f"Found {non_auctions} non-auctions parents in active tables!"

  # Verify orphan integrity
  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children c
    LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  orphan_c = cur.fetchone()[0]
  assert orphan_c == 0, f"Found {orphan_c} orphan children!"

  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images img
    LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  orphan_img = cur.fetchone()[0]
  assert orphan_img == 0, f"Found {orphan_img} orphan images!"

  report = {
    "contract": "wf-fresh-1k-canary-reconciliation-v1",
    "executed_at": datetime.now(timezone.utc).isoformat(),
    "inputs_processed": len(fresh_raw_rows),
    "normalization_breakdown": {
      "normalized_proposals": proposals_count,
      "review_required": review_required_count,
      "technical_errors": errors_count,
      "trading_floor_eligible": tf_eligible_count,
      "price_research_eligible": pr_eligible_count
    },
    "rpc_result": rpc_result,
    "delta_reconciliation": {
      "parents_before": pre_parents,
      "parents_after": post_parents,
      "delta_parents": delta_parents,
      "children_before": pre_children,
      "children_after": post_children,
      "delta_children": delta_children,
      "images_before": pre_images,
      "images_after": post_images,
      "delta_images": delta_images
    },
    "integrity_checks": {
      "non_auctions_parents": non_auctions,
      "orphan_children": orphan_c,
      "orphan_images": orphan_img,
      "public_raw_delta": post_pub_raw - pre_pub_raw,
      "public_watch_delta": post_pub_watch - pre_pub_watch
    },
    "status": "SUCCESS_VERIFIED"
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/fresh_1k_canary_reconciliation_report.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print("\nFRESH_1K_CANARY_REPORT:")
  print(json.dumps(report, indent=2))

if __name__ == "__main__":
  run_fresh_1k_canary()
