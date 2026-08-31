# tools/mariadb-live/apply_private_production_migration.py
import os
import sys
import psycopg2
import json
import datetime
import hashlib
from pathlib import Path

def load_status_contract():
  contract_path = Path(__file__).parent / "normalization-status-contract.json"
  if not contract_path.exists():
    contract_path = Path("tools/mariadb-live/normalization-status-contract.json")
  with open(contract_path, "r", encoding="utf-8") as f:
    return json.load(f)

def run_production_migration():
  start_time = datetime.datetime.now(datetime.timezone.utc)
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL is required for applying migration.", file=sys.stderr)
    sys.exit(1)

  contract = load_status_contract()
  migration_path = "supabase/migrations/20260830190000_canonical_parent_child_remediation.sql"
  with open(migration_path, "rb") as f:
    migration_bytes = f.read()
    migration_sha = hashlib.sha256(migration_bytes).hexdigest()
    migration_sql = migration_bytes.decode("utf-8")

  print(f"Connecting to private Supabase database...")
  conn = psycopg2.connect(db_url)
  conn.autocommit = False # Explicit transactional mode
  cur = conn.cursor()

  report = {
    "contract": "wf-private-production-migration-v1",
    "migration_file": migration_path,
    "migration_sha256": migration_sha,
    "execution_start_utc": start_time.isoformat(),
    "steps": []
  }

  try:
    # 1. Pre-migration state capture
    print("Step 1: Capturing pre-migration table counts and checkpoint state...")
    cur.execute("SELECT * FROM wf_canonical_staging.mariadb_raw_import_checkpoints WHERE run_key = %s;", ("full-capture-auctions-1788028958313",))
    cp_row = cur.fetchone()
    pre_cp = {
      "run_key": cp_row[0],
      "input_rows": cp_row[4],
      "newly_staged_rows": cp_row[5],
      "already_staged_identical_rows": cp_row[6],
      "capture_error_rows": cp_row[7],
      "status": cp_row[8]
    } if cp_row else None

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
    pre_parents = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
    pre_children = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
    pre_images = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_raw_source_rows;")
    pre_raw_rows = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
    pre_raw_messages = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM public.watch_records;")
    pre_watch_records = cur.fetchone()[0]

    report["pre_migration_state"] = {
      "checkpoint": pre_cp,
      "canonical_parents": pre_parents,
      "canonical_children": pre_children,
      "canonical_images": pre_images,
      "raw_source_rows": pre_raw_rows,
      "public_raw_messages": pre_raw_messages,
      "public_watch_records": pre_watch_records
    }
    report["steps"].append({"step": "PRE_STATE_CAPTURED", "status": "SUCCESS"})

    # 2. Configure safety timeouts
    print("Step 2: Setting conservative lock and statement timeouts...")
    cur.execute("SET lock_timeout = '10s';")
    cur.execute("SET statement_timeout = '60s';")
    report["steps"].append({"step": "TIMEOUTS_SET", "lock_timeout": "10s", "statement_timeout": "60s"})

    # 3. Apply migration SQL
    print("Step 3: Applying canonical parent/child remediation migration inside transaction...")
    cur.execute(migration_sql)
    report["steps"].append({"step": "MIGRATION_SQL_EXECUTED", "status": "SUCCESS"})

    # 4. Post-migration verification queries
    print("Step 4: Performing post-migration verification in transaction...")
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
    post_parents = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children WHERE is_active = TRUE;")
    post_children_active = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
    post_images = cur.fetchone()[0]

    # Orphan checks
    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children c
      LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
      WHERE p.id IS NULL;
    """)
    orphan_children = cur.fetchone()[0]

    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images img
      LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
      WHERE p.id IS NULL;
    """)
    orphan_images_parent = cur.fetchone()[0]

    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images img
      LEFT JOIN wf_canonical_staging.mariadb_normalized_children c ON img.child_id = c.id
      WHERE img.scope = 'CHILD' AND c.id IS NULL;
    """)
    orphan_images_child = cur.fetchone()[0]

    # Status compatibility check
    status_violations = 0
    for field in ["intent", "currency_status", "trading_floor_status", "price_research_status", "reconciliation_category", "primary_image_evidence_type"]:
      allowed = contract.get(field, [])
      cur.execute(f"""
        SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children
        WHERE {field} IS NOT NULL AND {field} NOT IN %s;
      """, (tuple(allowed),))
      field_viol = cur.fetchone()[0]
      if field_viol > 0:
        status_violations += field_viol

    # Public tables delta check
    cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
    post_raw_messages = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM public.watch_records;")
    post_watch_records = cur.fetchone()[0]

    public_delta = (post_raw_messages - pre_raw_messages) + (post_watch_records - pre_watch_records)

    post_state = {
      "parents_count": post_parents,
      "children_active_count": post_children_active,
      "images_count": post_images,
      "orphan_children": orphan_children,
      "orphan_images_parent": orphan_images_parent,
      "orphan_images_child": orphan_images_child,
      "status_violations": status_violations,
      "public_raw_messages": post_raw_messages,
      "public_watch_records": post_watch_records,
      "public_table_delta": public_delta
    }
    report["post_migration_state"] = post_state

    # Assert Invariants
    assert post_parents == 10000, f"Expected 10000 parents, got {post_parents}"
    assert post_children_active == 10241, f"Expected 10241 active children, got {post_children_active}"
    assert post_images == 10000, f"Expected 10000 images, got {post_images}"
    assert orphan_children == 0, f"Found {orphan_children} orphan children"
    assert orphan_images_parent == 0, f"Found {orphan_images_parent} orphan parent images"
    assert orphan_images_child == 0, f"Found {orphan_images_child} orphan child images"
    assert status_violations == 0, f"Found {status_violations} status contract violations"
    assert public_delta == 0, f"Unexpected public table delta: {public_delta}"

    # Step 5: Commit transaction
    print("Step 5: All post-migration assertions verified. Committing transaction...")
    conn.commit()
    report["status"] = "COMMITTED_SUCCESSFULLY"
    report["steps"].append({"step": "TRANSACTION_COMMITTED", "status": "SUCCESS"})

  except Exception as e:
    print(f"FATAL_MIGRATION_ERROR: {e}. Rolling back immediately...", file=sys.stderr)
    conn.rollback()
    report["status"] = "ROLLED_BACK"
    report["error"] = str(e)
    out_path = "audit-output/mariadb-live/canonical-canary-10k/private_production_migration_report.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
      json.dump(report, f, indent=2)
    sys.exit(1)

  finally:
    cur.close()
    conn.close()

  end_time = datetime.datetime.now(datetime.timezone.utc)
  report["execution_end_utc"] = end_time.isoformat()
  report["duration_seconds"] = (end_time - start_time).total_seconds()

  out_path = "audit-output/mariadb-live/canonical-canary-10k/private_production_migration_report.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print("MIGRATION_APPLICATION_COMPLETE:")
  print(json.dumps(report, indent=2))
  return report

if __name__ == "__main__":
  run_production_migration()
