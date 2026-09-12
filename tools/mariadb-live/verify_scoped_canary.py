# tools/mariadb-live/verify_scoped_canary.py
import os
import sys
import json
import datetime
import subprocess
import psycopg2

def verify_scoped_canaries():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL is required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()

  report = {
    "contract": "wf-scoped-canary-reconciliation-report-v1",
    "executed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "stages": {}
  }

  print("================================================================")
  print("STAGE 1: Pre-Canary Baseline Measurement")
  print("================================================================")
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_before = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_before = cur.fetchone()[0]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  active_parents_before = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
  active_children_before = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  active_images_before = cur.fetchone()[0]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;")
  quarantined_parents = cur.fetchone()[0]

  print(f"Active Baseline: Parents={active_parents_before:,}, Children={active_children_before:,}, Images={active_images_before:,}")
  print(f"Quarantined Baseline: Parents={quarantined_parents:,}")
  print(f"Public Baseline: Raw Messages={pub_raw_before:,}, Watch Records={pub_watch_before:,}")

  report["stages"]["baseline"] = {
    "active_parents": active_parents_before,
    "active_children": active_children_before,
    "active_images": active_images_before,
    "quarantined_parents": quarantined_parents,
    "public_raw_messages": pub_raw_before,
    "public_watch_records": pub_watch_before
  }

  # STAGE 2: 1K Canary Execution (1 Batch)
  print("\n================================================================")
  print("STAGE 2: Executing 1K Scoped Canary (1 Batch = 1,000 rows)...")
  print("================================================================")
  # Reset checkpoint for fresh 1K run test
  cur.execute("DELETE FROM wf_canonical_staging.mariadb_normalization_checkpoints WHERE job_name = 'milestone-951750-scoped-auctions-canonical-v1';")
  conn.commit()

  p = subprocess.run([sys.executable, "-u", "tools/mariadb-live/run_scoped_canonical_normalizer.py", "1"], capture_output=True, text=True)
  print(p.stdout)
  if p.returncode != 0:
    print(p.stderr, file=sys.stderr)
    raise RuntimeError(f"1K Canary failed with exit code {p.returncode}")

  # Validate 1K Invariants
  cur.execute("""
    SELECT total_inputs_processed, normalized_proposals_count, review_required_count,
           normalization_errors_count, trading_floor_eligible_count, price_research_eligible_count, status
    FROM wf_canonical_staging.mariadb_normalization_checkpoints
    WHERE job_name = 'milestone-951750-scoped-auctions-canonical-v1';
  """)
  cp_1k = cur.fetchone()
  assert cp_1k[0] == 1000, f"Expected 1,000 processed in checkpoint, got {cp_1k[0]}"
  print(f"1K Checkpoint Verified: Total={cp_1k[0]:,}, Proposals={cp_1k[1]:,}, ReviewRequired={cp_1k[2]:,}, Errors={cp_1k[3]}, Status={cp_1k[6]}")

  # Check scope integrity
  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system <> 'OceanDigital MariaDB'
       OR source_database <> 'thecollective_inventory'
       OR source_table <> 'auctions';
  """)
  contam_1k = cur.fetchone()[0]
  assert contam_1k == 0, f"Found {contam_1k} non-auction parents after 1K canary"

  # Check public isolation
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_1k = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_1k = cur.fetchone()[0]
  assert pub_raw_1k == pub_raw_before, "Public raw_messages modified during 1K canary!"
  assert pub_watch_1k == pub_watch_before, "Public watch_records modified during 1K canary!"

  report["stages"]["canary_1k"] = {
    "total_inputs_processed": cp_1k[0],
    "normalized_proposals_count": cp_1k[1],
    "review_required_count": cp_1k[2],
    "normalization_errors_count": cp_1k[3],
    "trading_floor_eligible_count": cp_1k[4],
    "price_research_eligible_count": cp_1k[5],
    "non_auction_parents": contam_1k,
    "public_delta": 0,
    "status": "PASSED"
  }

  # STAGE 3: Idempotent Rerun Test of 1K Batch
  print("\n================================================================")
  print("STAGE 3: Testing Idempotent Rerun on 1K Batch...")
  print("================================================================")
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  parents_count_before_rerun = cur.fetchone()[0]

  # Rewind checkpoint cursor to 0 to simulate replay of same 1,000 rows
  cur.execute("""
    UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
    SET last_processed_created_on = NULL,
        last_processed_source_id = NULL,
        total_inputs_processed = 0,
        normalized_proposals_count = 0,
        review_required_count = 0,
        normalization_errors_count = 0,
        trading_floor_eligible_count = 0,
        price_research_eligible_count = 0
    WHERE job_name = 'milestone-951750-scoped-auctions-canonical-v1';
  """)
  conn.commit()

  p_rerun = subprocess.run([sys.executable, "-u", "tools/mariadb-live/run_scoped_canonical_normalizer.py", "1"], capture_output=True, text=True)
  print(p_rerun.stdout)
  if p_rerun.returncode != 0:
    print(p_rerun.stderr, file=sys.stderr)
    raise RuntimeError(f"Idempotency rerun failed with exit code {p_rerun.returncode}")

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  parents_count_after_rerun = cur.fetchone()[0]
  assert parents_count_after_rerun == parents_count_before_rerun, f"Idempotency violation: Parent count changed from {parents_count_before_rerun} to {parents_count_after_rerun}"
  print(f"Idempotency Verified: Parent count remained exactly {parents_count_after_rerun:,} after full replay.")

  report["stages"]["idempotency_rerun"] = {
    "parents_count_before": parents_count_before_rerun,
    "parents_count_after": parents_count_after_rerun,
    "delta": 0,
    "status": "PASSED"
  }

  # STAGE 4: 10K Canary Execution (9 additional Batches = 10,000 rows total)
  print("\n================================================================")
  print("STAGE 4: Executing 10K Scoped Canary (9 more batches to reach 10,000 total)...")
  print("================================================================")
  p_10k = subprocess.run([sys.executable, "-u", "tools/mariadb-live/run_scoped_canonical_normalizer.py", "9"], capture_output=True, text=True)
  print(p_10k.stdout)
  if p_10k.returncode != 0:
    print(p_10k.stderr, file=sys.stderr)
    raise RuntimeError(f"10K Canary failed with exit code {p_10k.returncode}")

  # Validate 10K Invariants
  cur.execute("""
    SELECT total_inputs_processed, normalized_proposals_count, review_required_count,
           normalization_errors_count, trading_floor_eligible_count, price_research_eligible_count, status
    FROM wf_canonical_staging.mariadb_normalization_checkpoints
    WHERE job_name = 'milestone-951750-scoped-auctions-canonical-v1';
  """)
  cp_10k = cur.fetchone()
  assert cp_10k[0] == 10000, f"Expected 10,000 processed in checkpoint, got {cp_10k[0]}"
  print(f"10K Checkpoint Verified: Total={cp_10k[0]:,}, Proposals={cp_10k[1]:,}, ReviewRequired={cp_10k[2]:,}, Errors={cp_10k[3]}, Status={cp_10k[6]}")

  # Verify Scope and Lineage Integrity
  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system <> 'OceanDigital MariaDB'
       OR source_database <> 'thecollective_inventory'
       OR source_table <> 'auctions';
  """)
  contam_10k = cur.fetchone()[0]
  assert contam_10k == 0, f"Found {contam_10k} non-auction parents after 10K canary"

  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children c
    LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  orphan_children_10k = cur.fetchone()[0]
  assert orphan_children_10k == 0, f"Found {orphan_children_10k} orphan children after 10K canary"

  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images img
    LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  orphan_images_10k = cur.fetchone()[0]
  assert orphan_images_10k == 0, f"Found {orphan_images_10k} orphan images after 10K canary"

  # Public check
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_10k = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_10k = cur.fetchone()[0]
  assert pub_raw_10k == pub_raw_before, "Public raw_messages modified during 10K canary!"
  assert pub_watch_10k == pub_watch_before, "Public watch_records modified during 10K canary!"

  report["stages"]["canary_10k"] = {
    "total_inputs_processed": cp_10k[0],
    "normalized_proposals_count": cp_10k[1],
    "review_required_count": cp_10k[2],
    "normalization_errors_count": cp_10k[3],
    "trading_floor_eligible_count": cp_10k[4],
    "price_research_eligible_count": cp_10k[5],
    "non_auction_parents": contam_10k,
    "orphan_children": orphan_children_10k,
    "orphan_images": orphan_images_10k,
    "public_delta": 0,
    "status": "PASSED"
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/scoped_canary_reconciliation_report.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print("\nSCOPED_CANARY_VERIFICATION_COMPLETE:")
  print(json.dumps(report, indent=2))

if __name__ == "__main__":
  verify_scoped_canaries()
