# tools/mariadb-live/verify_quarantine_integrity.py
import os
import sys
import json
import datetime
import psycopg2

def verify_quarantine():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("==================================================================")
  print("1. QUARANTINE TABLE RECORD COUNTS")
  print("==================================================================")
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;")
  q_parents = cur.fetchone()[0]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_children;")
  q_children = cur.fetchone()[0]

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_images;")
  q_images = cur.fetchone()[0]

  print(f"Quarantined Parents:  {q_parents:,}")
  print(f"Quarantined Children: {q_children:,}")
  print(f"Quarantined Images:   {q_images:,}")

  assert q_parents == 435558, f"Expected 435,558 quarantined parents, got {q_parents}"
  assert q_children == 459930, f"Expected 459,930 quarantined children, got {q_children}"
  assert q_images == 459918, f"Expected 459,918 quarantined images, got {q_images}"

  print("\n==================================================================")
  print("2. QUARANTINE NAMESPACE BREAKDOWN")
  print("==================================================================")
  cur.execute("""
    SELECT source_table, COUNT(*)
    FROM wf_canonical_staging.mariadb_quarantine_canonical_parents
    GROUP BY source_table
    ORDER BY COUNT(*) DESC;
  """)
  ns_dist = cur.fetchall()
  for r in ns_dist:
    print(f"  {r[0]}: {r[1]:,}")

  print("\n==================================================================")
  print("3. HASH AND INTEGRITY VALIDATIONS")
  print("==================================================================")
  cur.execute("""
    SELECT 
      COUNT(*) FILTER (WHERE parent_hash IS NULL OR parent_hash !~ '^[0-9a-f]{64}$') AS invalid_parent_hashes,
      COUNT(*) FILTER (WHERE source_hash IS NULL OR source_hash !~ '^[0-9a-f]{64}$') AS invalid_source_hashes,
      COUNT(*) FILTER (WHERE quarantine_reason <> 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION') AS non_standard_reason
    FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;
  """)
  inv_ph, inv_sh, non_std = cur.fetchone()
  print(f"Invalid Parent Hashes: {inv_ph}")
  print(f"Invalid Source Hashes: {inv_sh}")
  print(f"Non-Standard Reasons:  {non_std}")
  assert inv_ph == 0 and inv_sh == 0 and non_std == 0

  cur.execute("""
    SELECT 
      COUNT(*) FILTER (WHERE child_proposal_hash IS NULL OR child_proposal_hash !~ '^[0-9a-f]{64}$') AS invalid_child_hashes
    FROM wf_canonical_staging.mariadb_quarantine_canonical_children;
  """)
  inv_ch = cur.fetchone()[0]
  print(f"Invalid Child Proposal Hashes: {inv_ch}")
  assert inv_ch == 0

  print("\n==================================================================")
  print("4. RECOVERABILITY & ORPHAN CHECKS IN QUARANTINE")
  print("==================================================================")
  cur.execute("""
    SELECT COUNT(*)
    FROM wf_canonical_staging.mariadb_quarantine_canonical_children c
    LEFT JOIN wf_canonical_staging.mariadb_quarantine_canonical_parents p ON c.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  q_orphan_children = cur.fetchone()[0]

  cur.execute("""
    SELECT COUNT(*)
    FROM wf_canonical_staging.mariadb_quarantine_canonical_images img
    LEFT JOIN wf_canonical_staging.mariadb_quarantine_canonical_parents p ON img.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  q_orphan_images = cur.fetchone()[0]

  print(f"Quarantine Orphan Children: {q_orphan_children}")
  print(f"Quarantine Orphan Images:   {q_orphan_images}")
  assert q_orphan_children == 0
  assert q_orphan_images == 0

  report = {
    "contract": "wf-quarantine-integrity-verification-v1",
    "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "quarantine_counts": {
      "parents": q_parents,
      "children": q_children,
      "images": q_images
    },
    "namespace_breakdown": {r[0]: r[1] for r in ns_dist},
    "integrity_checks": {
      "invalid_parent_hashes": inv_ph,
      "invalid_source_hashes": inv_sh,
      "invalid_child_hashes": inv_ch,
      "non_standard_reasons": non_std,
      "orphan_children": q_orphan_children,
      "orphan_images": q_orphan_images
    },
    "recoverability_status": "100%_LINEAGE_PRESERVED_RECOVERABLE",
    "status": "PASSED"
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/quarantine_integrity_verification.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print(f"\nSaved full quarantine integrity verification artifact to {out_path}")

if __name__ == "__main__":
  verify_quarantine()
