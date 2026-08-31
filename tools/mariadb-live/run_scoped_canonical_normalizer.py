# tools/mariadb-live/run_scoped_canonical_normalizer.py
# Authoritative Scoped Canonical Milestone Normalizer
# Strictly restricted to:
#   source_system = 'OceanDigital MariaDB'
#   source_database = 'thecollective_inventory'
#   source_table = 'auctions'
# Frozen cursor: 2026-04-28T15:50:43.000Z / 3cddaf9f-9f36-4633-a08e-59a6dfdca057

import os
import sys
import json
import time
import subprocess
from collections import defaultdict
import psycopg2
from psycopg2.extras import execute_values

JOB_NAME = "milestone-951750-scoped-auctions-canonical-v1"
FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"
EXPECTED_SCOPED_ROWS = 955743
BATCH_SIZE = 1000
MAX_TECHNICAL_ERROR_THRESHOLD = 10

REQUIRED_SOURCE_SYSTEM = "OceanDigital MariaDB"
REQUIRED_SOURCE_DATABASE = "thecollective_inventory"
REQUIRED_SOURCE_TABLE = "auctions"

def ensure_error_ledger(cur):
  cur.execute("""
    CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;
    CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalization_errors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_name TEXT NOT NULL,
      source_id UUID NOT NULL,
      source_system TEXT NOT NULL,
      source_database TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_record_id TEXT,
      source_created_on TEXT,
      error_message TEXT NOT NULL,
      raw_message_snippet TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mariadb_norm_errors_job ON wf_canonical_staging.mariadb_normalization_errors (job_name, occurred_at);
  """)

def run_scoped_normalizer(limit_batches=None):
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL is required.", file=sys.stderr)
    sys.exit(1)

  print(f"[Scoped-Normalizer] Connecting to private Supabase staging...", flush=True)
  conn = psycopg2.connect(db_url)
  conn.autocommit = False
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  ensure_error_ledger(cur)
  conn.commit()

  # Step 1: Strict Scoped Preflight Verification
  print(f"[Scoped-Normalizer] Running strict scoped cohort preflight validation...", flush=True)
  cur.execute("""
    SELECT COUNT(*)
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = %s
      AND source_database = %s
      AND source_table = %s
      AND (source_created_on, source_id) <= (%s, %s);
  """, (REQUIRED_SOURCE_SYSTEM, REQUIRED_SOURCE_DATABASE, REQUIRED_SOURCE_TABLE, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
  scoped_count = cur.fetchone()[0]
  print(f"[Scoped-Normalizer] Preflight scoped cohort count: {scoped_count:,}", flush=True)

  if scoped_count != EXPECTED_SCOPED_ROWS:
    raise ValueError(f"SCOPED_PREFLIGHT_FAILURE: Expected exactly {EXPECTED_SCOPED_ROWS} rows for auctions scope, found {scoped_count}")

  # Check for foreign/benchmark contamination in query scope
  cur.execute("""
    SELECT COUNT(*)
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE (source_system <> %s OR source_database <> %s OR source_table <> %s)
      AND (source_created_on, source_id) <= (%s, %s);
  """, (REQUIRED_SOURCE_SYSTEM, REQUIRED_SOURCE_DATABASE, REQUIRED_SOURCE_TABLE, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
  non_scoped_staged = cur.fetchone()[0]
  print(f"[Scoped-Normalizer] Non-auctions staged rows excluded from cohort: {non_scoped_staged:,}", flush=True)

  # Step 2: Checkpoint Check / Init
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
    raw_cursor_date = cp_row[1]
    if hasattr(raw_cursor_date, 'strftime'):
      last_created_on = raw_cursor_date.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    else:
      last_created_on = str(raw_cursor_date).replace('+00:00', '').replace(' ', 'T') if raw_cursor_date else None
    last_source_id = str(cp_row[2]) if cp_row[2] else None
    total_processed = cp_row[3] or 0
    normalized_proposals = cp_row[4] or 0
    review_required = cp_row[5] or 0
    normalization_errors = cp_row[6] or 0
    tf_eligible = cp_row[7] or 0
    pr_eligible = cp_row[8] or 0
    print(f"[Scoped-Normalizer] Resuming from checkpoint: processed={total_processed:,}, cursor={last_created_on} / {last_source_id}", flush=True)
  else:
    cur.execute("""
      INSERT INTO wf_canonical_staging.mariadb_normalization_checkpoints (
        job_name, frozen_cursor_created_on, frozen_cursor_source_id, expected_staged_rows, status
      ) VALUES (%s, %s, %s, %s, 'IN_PROGRESS');
    """, (JOB_NAME, FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID, EXPECTED_SCOPED_ROWS))
    conn.commit()
    print(f"[Scoped-Normalizer] Initialized new scoped checkpoint '{JOB_NAME}' for {EXPECTED_SCOPED_ROWS:,} rows.", flush=True)

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
      if limit_batches and batch_count >= limit_batches:
        print(f"[Scoped-Normalizer] Reached requested limit of {limit_batches} batches. Halting canary cleanly.", flush=True)
        break

      batch_count += 1
      t_batch_start = time.time()

      if last_created_on and last_source_id:
        query = """
          SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
                 source_created_on, raw_message, raw_payload
          FROM wf_canonical_staging.mariadb_raw_source_rows
          WHERE source_system = %s
            AND source_database = %s
            AND source_table = %s
            AND (source_created_on, source_id) > (%s, %s)
            AND (source_created_on, source_id) <= (%s, %s)
          ORDER BY source_created_on ASC, source_id ASC
          LIMIT %s;
        """
        params = (REQUIRED_SOURCE_SYSTEM, REQUIRED_SOURCE_DATABASE, REQUIRED_SOURCE_TABLE,
                  str(last_created_on), str(last_source_id), str(FROZEN_CURSOR_DATE), str(FROZEN_CURSOR_ID), BATCH_SIZE)
      else:
        query = """
          SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
                 source_created_on, raw_message, raw_payload
          FROM wf_canonical_staging.mariadb_raw_source_rows
          WHERE source_system = %s
            AND source_database = %s
            AND source_table = %s
            AND (source_created_on, source_id) <= (%s, %s)
          ORDER BY source_created_on ASC, source_id ASC
          LIMIT %s;
        """
        params = (REQUIRED_SOURCE_SYSTEM, REQUIRED_SOURCE_DATABASE, REQUIRED_SOURCE_TABLE,
                  str(FROZEN_CURSOR_DATE), str(FROZEN_CURSOR_ID), BATCH_SIZE)

      cur.execute(query, params)
      rows = cur.fetchall()

      if not rows:
        print(f"[Scoped-Normalizer] Reached end of scoped cohort stream. All {total_processed:,} records normalized.", flush=True)
        has_more = False
        break

      raw_batch = []
      for r in rows:
        # Enforce strict scope assertion on every row in memory
        if r[1] != REQUIRED_SOURCE_SYSTEM or r[2] != REQUIRED_SOURCE_DATABASE or r[3] != REQUIRED_SOURCE_TABLE:
          raise ValueError(f"CRITICAL_SCOPE_VIOLATION: Row {r[0]} belongs to {r[1]}.{r[2]}.{r[3]}, expected {REQUIRED_SOURCE_SYSTEM}.{REQUIRED_SOURCE_DATABASE}.{REQUIRED_SOURCE_TABLE}")
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

      # Send entire batch array to node worker
      worker.stdin.write(json.dumps(raw_batch) + "\n")
      worker.stdin.flush()
      line = worker.stdout.readline()
      batch_results = json.loads(line)

      batch_parents = []
      batch_errors = []

      for idx, res in enumerate(batch_results):
        total_processed += 1
        r = rows[idx]

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
          err_msg = res.get("error", "Unknown normalization error")
          batch_errors.append((
            JOB_NAME, r[0], r[1], r[2], r[3], r[5], r[6], err_msg, (r[7] or "")[:200]
          ))
          print(f"[Technical Error] Source {r[0]}: {err_msg}", file=sys.stderr, flush=True)

        last_created_on = r[6]
        last_source_id = r[0]

      # Check technical error threshold
      if normalization_errors > MAX_TECHNICAL_ERROR_THRESHOLD:
        raise RuntimeError(f"FAIL_CLOSED: Normalization technical errors exceeded threshold ({normalization_errors} > {MAX_TECHNICAL_ERROR_THRESHOLD})")

      # REQUIREMENT 6: Single Atomic PostgreSQL Transaction
      # Upsert parents + write error ledger + advance checkpoint in ONE transaction
      if batch_parents:
        cur.execute("SELECT public.upsert_mariadb_canonical_batch(%s::jsonb);", (json.dumps(batch_parents),))

      if batch_errors:
        execute_values(cur, """
          INSERT INTO wf_canonical_staging.mariadb_normalization_errors (
            job_name, source_id, source_system, source_database, source_table,
            source_record_id, source_created_on, error_message, raw_message_snippet
          ) VALUES %s;
        """, batch_errors)

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

      # Commit entire atomic batch
      conn.commit()

      t_batch_end = time.time()
      batch_duration = t_batch_end - t_batch_start
      rps = len(rows) / batch_duration if batch_duration > 0 else 0

      if batch_count % 10 == 0 or not has_more or (limit_batches and batch_count == limit_batches):
        pct = (total_processed / EXPECTED_SCOPED_ROWS) * 100
        print(f"[Scoped-Normalizer] Progress: {total_processed:,} / {EXPECTED_SCOPED_ROWS:,} ({pct:.1f}%) | Speed: {rps:.1f} rows/s | Proposals: {normalized_proposals:,} | Review: {review_required:,} | Errors: {normalization_errors} | TF: {tf_eligible:,} | PR: {pr_eligible:,}", flush=True)

    # Mark COMPLETED if all scoped rows processed
    if total_processed >= EXPECTED_SCOPED_ROWS and not limit_batches:
      cur.execute("""
        UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
        SET status = 'COMPLETED', updated_at = NOW()
        WHERE job_name = %s;
      """, (JOB_NAME,))
      conn.commit()
      print(f"[Scoped-Normalizer] Successfully completed full scoped cohort milestone!", flush=True)

  except Exception as e:
    conn.rollback()
    print(f"[Scoped-Normalizer FATAL] Transaction rolled back due to error: {e}", file=sys.stderr, flush=True)
    try:
      cur.execute("""
        UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
        SET status = 'CRASHED', updated_at = NOW()
        WHERE job_name = %s;
      """, (JOB_NAME,))
      conn.commit()
    except Exception:
      pass
    raise
  finally:
    worker.terminate()
    cur.close()
    conn.close()

if __name__ == "__main__":
  limit = None
  if len(sys.argv) > 1:
    limit = int(sys.argv[1])
  run_scoped_normalizer(limit_batches=limit)
