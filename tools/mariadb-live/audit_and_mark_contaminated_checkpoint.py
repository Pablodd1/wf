# tools/mariadb-live/audit_and_mark_contaminated_checkpoint.py
import os
import sys
import json
import datetime
import psycopg2

def audit_and_mark():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  conn.autocommit = True
  cur = conn.cursor()

  print("Step 1: Auditing current canonical normalized tables breakdown by scope...")

  # Parents breakdown
  cur.execute("""
    SELECT source_system, source_database, source_table, COUNT(*)
    FROM wf_canonical_staging.mariadb_normalized_parents
    GROUP BY source_system, source_database, source_table
    ORDER BY 4 DESC;
  """)
  parent_breakdown = [
    {"source_system": r[0], "source_database": r[1], "source_table": r[2], "count": r[3]}
    for r in cur.fetchall()
  ]

  # Total parents
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  total_parents = cur.fetchone()[0]

  # Genuine auctions parents
  cur.execute("""
    SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions';
  """)
  genuine_parents = cur.fetchone()[0]
  contaminated_parents = total_parents - genuine_parents

  # Children breakdown by parent source_table
  cur.execute("""
    SELECT p.source_table, COUNT(c.id)
    FROM wf_canonical_staging.mariadb_normalized_children c
    JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
    GROUP BY p.source_table
    ORDER BY 2 DESC;
  """)
  child_breakdown = [{"source_table": r[0], "count": r[1]} for r in cur.fetchall()]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children WHERE is_active = TRUE;")
  total_active_children = cur.fetchone()[0]

  # Images breakdown by parent source_table
  cur.execute("""
    SELECT p.source_table, COUNT(img.id)
    FROM wf_canonical_staging.mariadb_normalized_images img
    JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
    GROUP BY p.source_table
    ORDER BY 2 DESC;
  """)
  image_breakdown = [{"source_table": r[0], "count": r[1]} for r in cur.fetchall()]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
  total_images = cur.fetchone()[0]

  # Checkpoint state
  cur.execute("""
    SELECT * FROM wf_canonical_staging.mariadb_normalization_checkpoints
    WHERE job_name = 'milestone-951750-canonical-normalization';
  """)
  cp_row = cur.fetchone()
  old_cp_state = {
    "job_name": cp_row[0] if cp_row else None,
    "total_inputs_processed": cp_row[6] if cp_row else None,
    "normalized_proposals_count": cp_row[7] if cp_row else None,
    "review_required_count": cp_row[8] if cp_row else None,
    "normalization_errors_count": cp_row[9] if cp_row else None,
    "trading_floor_eligible_count": cp_row[10] if cp_row else None,
    "price_research_eligible_count": cp_row[11] if cp_row else None,
    "status": cp_row[12] if cp_row else None,
    "updated_at": str(cp_row[13]) if cp_row else None
  } if cp_row else None

  # Raw capture checkpoint
  cur.execute("""
    SELECT run_key, input_rows, newly_staged_rows, already_staged_identical_rows, 
           capture_error_rows, status, last_created_on, last_source_id
    FROM wf_canonical_staging.mariadb_raw_import_checkpoints
    WHERE run_key = 'full-capture-auctions-1788028958313';
  """)
  raw_cp = cur.fetchone()

  # Public tables counts
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_count = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_count = cur.fetchone()[0]

  audit_report = {
    "contract": "wf-canonical-scope-contamination-audit-v1",
    "audited_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "contaminated_checkpoint": old_cp_state,
    "raw_capture_checkpoint": {
      "run_key": raw_cp[0] if raw_cp else None,
      "input_rows": raw_cp[1] if raw_cp else 0,
      "newly_staged_rows": raw_cp[2] if raw_cp else 0,
      "already_staged_identical_rows": raw_cp[3] if raw_cp else 0,
      "capture_error_rows": raw_cp[4] if raw_cp else 0,
      "status": raw_cp[5] if raw_cp else None
    },
    "canonical_tables_summary": {
      "total_parents": total_parents,
      "genuine_auctions_parents": genuine_parents,
      "contaminated_non_auctions_parents": contaminated_parents,
      "total_active_children": total_active_children,
      "total_images": total_images
    },
    "parents_breakdown": parent_breakdown,
    "children_breakdown": child_breakdown,
    "images_breakdown": image_breakdown,
    "public_production_tables": {
      "public_raw_messages": pub_raw_count,
      "public_watch_records": pub_watch_count,
      "public_delta": 0
    }
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/contaminated_state_audit.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(audit_report, f, indent=2)

  print("Step 2: Preserved contaminated state audit snapshot to:", out_path)

  # Step 3: Mark contaminated checkpoint as FAILED_SCOPE_CONTAMINATION
  print("Step 3: Marking milestone-951750-canonical-normalization as FAILED_SCOPE_CONTAMINATION...")
  cur.execute("""
    UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
    SET status = 'FAILED_SCOPE_CONTAMINATION', updated_at = NOW()
    WHERE job_name = 'milestone-951750-canonical-normalization';
  """)

  print("CONTAMINATED_STATE_AUDIT_COMPLETE:")
  print(json.dumps(audit_report, indent=2))

  cur.close()
  conn.close()

if __name__ == "__main__":
  audit_and_mark()
