# tools/mariadb-live/run_canonical_milestone_normalizer.py
import os
import sys
import json
import time
import datetime
import subprocess
import psycopg2
from collections import defaultdict
from pathlib import Path

JOB_NAME = "milestone-951750-canonical-normalization"
FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"
BATCH_SIZE = 1000
REPORT_INTERVAL = 10000

def run_milestone_normalizer():
  start_time = time.time()
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL is required.", file=sys.stderr, flush=True)
    sys.exit(1)

  print("[Milestone-Normalizer] Connecting to Supabase private staging...", flush=True)
  conn = psycopg2.connect(db_url)
  conn.autocommit = True
  cur = conn.cursor()

  # Ensure checkpoints table
  cur.execute("""
    CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalization_checkpoints (
      job_name TEXT PRIMARY KEY,
      frozen_cursor_created_on TIMESTAMPTZ,
      frozen_cursor_source_id TEXT,
      expected_staged_rows BIGINT,
      last_processed_created_on TEXT,
      last_processed_source_id TEXT,
      total_inputs_processed BIGINT DEFAULT 0,
      normalized_proposals_count BIGINT DEFAULT 0,
      review_required_count BIGINT DEFAULT 0,
      normalization_errors_count BIGINT DEFAULT 0,
      trading_floor_eligible_count BIGINT DEFAULT 0,
      price_research_eligible_count BIGINT DEFAULT 0,
      status TEXT DEFAULT 'IN_PROGRESS',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  """)

  # Check existing progress
  cur.execute("""
    SELECT job_name, last_processed_created_on, last_processed_source_id,
           total_inputs_processed, normalized_proposals_count, review_required_count,
           normalization_errors_count, trading_floor_eligible_count, price_research_eligible_count, status
    FROM wf_canonical_staging.mariadb_normalization_checkpoints
    WHERE job_name = %s;
  """, (JOB_NAME,))
  cp_row = cur.fetchone()

  last_created_on = None
  last_source_id = None
  total_processed = 0
  normalized_proposals = 0
  review_required = 0
  normalization_errors = 0
  tf_eligible = 0
  pr_eligible = 0

  if cp_row:
    last_created_on = cp_row[1]
    last_source_id = cp_row[2]
    total_processed = cp_row[3] or 0
    normalized_proposals = cp_row[4] or 0
    review_required = cp_row[5] or 0
    normalization_errors = cp_row[6] or 0
    tf_eligible = cp_row[7] or 0
    pr_eligible = cp_row[8] or 0
    print(f"[Milestone-Normalizer] Resuming from checkpoint: processed={total_processed:,}, cursor={last_created_on} / {last_source_id}", flush=True)
  else:
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_normalization_checkpoints (
        job_name, frozen_cursor_created_on, frozen_cursor_source_id, expected_staged_rows, status
      ) VALUES (%s, %s, %s, %s, 'IN_PROGRESS');
    """, (JOB_NAME, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, 951743))
    print(f"[Milestone-Normalizer] Initialized fresh checkpoint for milestone 951,750.", flush=True)

  # Launch long-running Node worker process
  worker_cmd = ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"]
  worker = subprocess.Popen(
    worker_cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    encoding="utf-8",
    errors="replace",
    bufsize=1
  )

  currency_counts = defaultdict(int)
  intent_counts = defaultdict(int)

  has_more = True
  batch_count = 0

  try:
    while has_more:
      batch_count += 1

      if last_created_on and last_source_id:
        query = """
          SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
                 source_created_on, raw_message, raw_payload
          FROM wf_canonical_staging.mariadb_raw_source_rows
          WHERE (source_created_on > %s OR (source_created_on = %s AND source_id > %s))
            AND (source_created_on < %s OR (source_created_on = %s AND source_id <= %s))
          ORDER BY source_created_on ASC, source_id ASC
          LIMIT %s;
        """
        params = (last_created_on, last_created_on, last_source_id, FROZEN_CURSOR_DATE, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, BATCH_SIZE)
      else:
        query = """
          SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
                 source_created_on, raw_message, raw_payload
          FROM wf_canonical_staging.mariadb_raw_source_rows
          WHERE (source_created_on < %s OR (source_created_on = %s AND source_id <= %s))
          ORDER BY source_created_on ASC, source_id ASC
          LIMIT %s;
        """
        params = (FROZEN_CURSOR_DATE, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, BATCH_SIZE)

      cur.execute(query, params)
      rows = cur.fetchall()

      if not rows:
        print("[Milestone-Normalizer] No more rows found in milestone cohort.", flush=True)
        has_more = False
        break

      batch_parents = []

      for r in rows:
        raw_row = {
          "source_id": r[0],
          "source_system": r[1],
          "source_database": r[2],
          "source_table": r[3],
          "source_hash": r[4],
          "source_record_id": r[5],
          "source_created_on": r[6],
          "raw_message": r[7],
          "raw_payload": r[8]
        }

        # Send to node worker
        worker.stdin.write(json.dumps(raw_row) + "\n")
        worker.stdin.flush()
        line = worker.stdout.readline()
        res = json.loads(line)

        total_processed += 1

        if res.get("success"):
          parent = res["parent"]
          batch_parents.append(parent)
          if res.get("is_review_required"):
            review_required += 1
          else:
            normalized_proposals += 1

          for cs in res.get("children_stats", []):
            if cs.get("trading_floor_eligible"): tf_eligible += 1
            if cs.get("price_research_eligible"): pr_eligible += 1
            curr = cs.get("currency_status") or "UNKNOWN"
            currency_counts[curr] += 1
            intent = cs.get("intent") or "UNKNOWN"
            intent_counts[intent] += 1
        else:
          normalization_errors += 1
          print(f"[Error] Source {r[0]}: {res.get('error')}", file=sys.stderr, flush=True)

        last_created_on = r[6]
        last_source_id = r[0]

      # Execute batch upsert via RPC
      if batch_parents:
        cur.execute("SELECT public.upsert_mariadb_canonical_batch(%s::jsonb);", (json.dumps(batch_parents),))

      # Update checkpoint
      cur.execute("""
        UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
        SET last_processed_created_on = %s,
            last_processed_source_id = %s,
            total_inputs_processed = %s,
            normalized_proposals_count = %s,
            review_required_count = %s,
            normalization_errors_count = %s,
            trading_floor_eligible_count = %s,
            price_research_eligible_count = %s,
            updated_at = NOW()
        WHERE job_name = %s;
      """, (last_created_on, last_source_id, total_processed, normalized_proposals, review_required, normalization_errors, tf_eligible, pr_eligible, JOB_NAME))

      if total_processed % REPORT_INTERVAL < BATCH_SIZE or len(rows) < BATCH_SIZE:
        elapsed = time.time() - start_time
        rate = total_processed / elapsed if elapsed > 0 else 0
        print(f"[Progress] Processed {total_processed:,} rows ({rate:.1f} rows/s) | Norm: {normalized_proposals:,}, Review: {review_required:,}, Err: {normalization_errors}", flush=True)

    # Mark completed
    cur.execute("""
      UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
      SET status = 'COMPLETED', updated_at = NOW()
      WHERE job_name = %s;
    """, (JOB_NAME,))

  finally:
    worker.stdin.close()
    worker.terminate()
    cur.close()
    conn.close()

  elapsed_total = time.time() - start_time
  summary = {
    "contract": "wf-canonical-milestone-951k-normalization-v1",
    "job_name": JOB_NAME,
    "frozen_cursor": {
      "created_on": FROZEN_CURSOR_DATE,
      "source_id": FROZEN_CURSOR_ID
    },
    "total_inputs_processed": total_processed,
    "normalized_proposals_count": normalized_proposals,
    "review_required_count": review_required,
    "normalization_errors_count": normalization_errors,
    "trading_floor_eligible_count": tf_eligible,
    "price_research_eligible_count": pr_eligible,
    "currency_distribution": dict(currency_counts),
    "intent_distribution": dict(intent_counts),
    "duration_seconds": elapsed_total,
    "average_rate_rows_per_second": total_processed / elapsed_total if elapsed_total > 0 else 0,
    "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
  }

  out_path = "audit-output/mariadb-live/canonical-milestone-951k/canonical_milestone_951k_summary.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

  print("\n============================================================", flush=True)
  print("CANONICAL MILESTONE 951,750 NORMALIZATION COMPLETE", flush=True)
  print(json.dumps(summary, indent=2), flush=True)
  print("============================================================\n", flush=True)
  return summary

if __name__ == "__main__":
  run_milestone_normalizer()
