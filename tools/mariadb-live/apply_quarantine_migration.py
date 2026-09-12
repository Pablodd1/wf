# tools/mariadb-live/apply_quarantine_migration.py
import os
import sys
import json
import datetime
import psycopg2

def apply_quarantine():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  print("Connecting to private Supabase staging database...")
  conn = psycopg2.connect(db_url)
  cur = conn.cursor()

  try:
    # 1. DDL & Indexing phase
    conn.autocommit = True
    print("Step 1: Ensuring quarantine tables and foreign key indexes exist...")
    cur.execute("""
      CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_quarantine_canonical_parents (
        LIKE wf_canonical_staging.mariadb_normalized_parents INCLUDING ALL,
        quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        quarantine_reason TEXT NOT NULL DEFAULT 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
      );

      CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_quarantine_canonical_children (
        LIKE wf_canonical_staging.mariadb_normalized_children INCLUDING ALL,
        quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        quarantine_reason TEXT NOT NULL DEFAULT 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
      );

      CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_quarantine_canonical_images (
        LIKE wf_canonical_staging.mariadb_normalized_images INCLUDING ALL,
        quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        quarantine_reason TEXT NOT NULL DEFAULT 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
      );

      CREATE INDEX IF NOT EXISTS idx_mariadb_norm_children_parent_id
        ON wf_canonical_staging.mariadb_normalized_children(parent_id);

      CREATE INDEX IF NOT EXISTS idx_mariadb_norm_images_parent_id
        ON wf_canonical_staging.mariadb_normalized_images(parent_id);

      CREATE INDEX IF NOT EXISTS idx_mariadb_norm_images_child_id
        ON wf_canonical_staging.mariadb_normalized_images(child_id);

      CREATE INDEX IF NOT EXISTS idx_mariadb_norm_parents_source_table
        ON wf_canonical_staging.mariadb_normalized_parents(source_table);

      ANALYZE wf_canonical_staging.mariadb_normalized_parents;
      ANALYZE wf_canonical_staging.mariadb_normalized_children;
      ANALYZE wf_canonical_staging.mariadb_normalized_images;
    """)

    # 2. Baseline measurement
    print("Step 2: Measuring pre-quarantine baseline counts...")
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
    pre_total_parents = cur.fetchone()[0]

    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions';
    """)
    pre_genuine_parents = cur.fetchone()[0]
    pre_contaminated_parents = pre_total_parents - pre_genuine_parents

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
    pre_total_children = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
    pre_total_images = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
    pre_pub_raw = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM public.watch_records;")
    pre_pub_watch = cur.fetchone()[0]

    print(f"Pre-quarantine: Total Parents={pre_total_parents:,} (Genuine Auctions={pre_genuine_parents:,}, Contaminated={pre_contaminated_parents:,})")

    # 3. Batched Archival & Cleanup
    print("Step 3: Executing batched transactional quarantine and cleanup...")
    batch_size = 25000
    processed_parents = 0
    conn.autocommit = False

    while True:
      # Fetch a batch of contaminated parent IDs
      cur.execute("""
        SELECT id FROM wf_canonical_staging.mariadb_normalized_parents
        WHERE source_table <> 'auctions'
           OR source_system <> 'OceanDigital MariaDB'
           OR source_database <> 'thecollective_inventory'
        LIMIT %s;
      """, (batch_size,))
      rows = cur.fetchall()
      if not rows:
        break

      parent_ids = [r[0] for r in rows]

      # Archive parents, children, images
      cur.execute("""
        INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_parents
        SELECT p.*, NOW(), 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
        FROM wf_canonical_staging.mariadb_normalized_parents p
        WHERE p.id = ANY(%s::uuid[])
        ON CONFLICT (id) DO NOTHING;
      """, (parent_ids,))

      cur.execute("""
        INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_children
        SELECT c.*, NOW(), 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
        FROM wf_canonical_staging.mariadb_normalized_children c
        WHERE c.parent_id = ANY(%s::uuid[])
        ON CONFLICT (id) DO NOTHING;
      """, (parent_ids,))

      cur.execute("""
        INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_images
        SELECT img.*, NOW(), 'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION'
        FROM wf_canonical_staging.mariadb_normalized_images img
        WHERE img.parent_id = ANY(%s::uuid[])
        ON CONFLICT (id) DO NOTHING;
      """, (parent_ids,))

      # Delete from active tables in reverse dependency order
      cur.execute("DELETE FROM wf_canonical_staging.mariadb_normalized_images WHERE parent_id = ANY(%s::uuid[]);", (parent_ids,))
      cur.execute("DELETE FROM wf_canonical_staging.mariadb_normalized_children WHERE parent_id = ANY(%s::uuid[]);", (parent_ids,))
      cur.execute("DELETE FROM wf_canonical_staging.mariadb_normalized_parents WHERE id = ANY(%s::uuid[]);", (parent_ids,))

      conn.commit()
      processed_parents += len(parent_ids)
      print(f"Quarantined and removed {processed_parents:,} / {pre_contaminated_parents:,} contaminated parents...")

    conn.commit()

    # 4. Measure post-quarantine counts
    print("Step 4: Measuring post-quarantine invariants...")
    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
    post_active_parents = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;")
    post_quarantined_parents = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children;")
    post_active_children = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_children;")
    post_quarantined_children = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images;")
    post_active_images = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_images;")
    post_quarantined_images = cur.fetchone()[0]

    # Contamination check on active parents
    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents
      WHERE source_system <> 'OceanDigital MariaDB'
         OR source_database <> 'thecollective_inventory'
         OR source_table <> 'auctions';
    """)
    post_remaining_contaminated = cur.fetchone()[0]

    # Orphan checks
    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_children c
      LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
      WHERE p.id IS NULL;
    """)
    post_orphan_children = cur.fetchone()[0]

    cur.execute("""
      SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_images img
      LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
      WHERE p.id IS NULL;
    """)
    post_orphan_images = cur.fetchone()[0]

    # Public tables check
    cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
    post_pub_raw = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM public.watch_records;")
    post_pub_watch = cur.fetchone()[0]

    # Assertions
    assert post_remaining_contaminated == 0, f"Contaminated parents remain in active table: {post_remaining_contaminated}"
    assert post_orphan_children == 0, f"Orphan children found: {post_orphan_children}"
    assert post_orphan_images == 0, f"Orphan images found: {post_orphan_images}"
    assert post_active_parents == 201692, f"Active parents ({post_active_parents}) != 201,692"
    assert post_quarantined_parents == 435558, f"Quarantined parents ({post_quarantined_parents}) != 435,558"
    assert post_pub_raw == pre_pub_raw, "Public raw_messages modified!"
    assert post_pub_watch == pre_pub_watch, "Public watch_records modified!"

    report = {
      "contract": "wf-quarantine-cleanup-execution-report-v1",
      "executed_at": datetime.timezone.utc and datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "pre_quarantine": {
        "total_parents": pre_total_parents,
        "genuine_auctions_parents": pre_genuine_parents,
        "contaminated_benchmark_parents": pre_contaminated_parents,
        "total_children": pre_total_children,
        "total_images": pre_total_images
      },
      "post_quarantine": {
        "active_genuine_auctions_parents": post_active_parents,
        "quarantined_benchmark_parents": post_quarantined_parents,
        "active_children": post_active_children,
        "quarantined_children": post_quarantined_children,
        "active_images": post_active_images,
        "quarantined_images": post_quarantined_images,
        "remaining_contaminated_active_parents": post_remaining_contaminated,
        "orphan_children": post_orphan_children,
        "orphan_images": post_orphan_images
      },
      "public_production_isolation": {
        "public_raw_messages_before": pre_pub_raw,
        "public_raw_messages_after": post_pub_raw,
        "public_watch_records_before": pre_pub_watch,
        "public_watch_records_after": post_pub_watch,
        "public_delta": 0
      },
      "status": "SUCCESS_VERIFIED"
    }

    out_path = "audit-output/mariadb-live/canonical-scope-contamination/quarantine_cleanup_execution_report.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
      json.dump(report, f, indent=2)

    print("QUARANTINE_CLEANUP_EXECUTION_SUCCESS:")
    print(json.dumps(report, indent=2))

  except Exception as e:
    print(f"FATAL: Quarantine migration failed: {e}", file=sys.stderr)
    raise
  finally:
    cur.close()
    conn.close()

if __name__ == "__main__":
  apply_quarantine()
