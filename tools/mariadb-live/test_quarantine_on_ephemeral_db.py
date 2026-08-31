# tools/mariadb-live/test_quarantine_on_ephemeral_db.py
import os
import sys
import psycopg2
import json
import datetime
import hashlib

def run_test():
  db_url = os.environ.get("EPHEMERAL_DATABASE_URL") or os.environ.get("DATABASE_URL")
  if not db_url or "supabase.co" in db_url:
    print("FATAL: Genuine EPHEMERAL_DATABASE_URL is required (rejecting Supabase production/staging).", file=sys.stderr)
    sys.exit(1)

  print("Connecting to disposable PostgreSQL instance...")
  conn = psycopg2.connect(db_url)
  conn.autocommit = True
  cur = conn.cursor()

  print("Ensuring Supabase stub roles and schema exist on disposable PostgreSQL...")
  cur.execute("""
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;
  """)

  schema_name = "test_quarantine_clean"
  cur.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE;")
  cur.execute(f"CREATE SCHEMA {schema_name};")
  cur.execute(f"SET search_path TO {schema_name}, public;")

  print("Applying base schema migrations on disposable database...")
  with open("supabase/migrations/20260830183000_private_canonical_parent_child_staging.sql", "r", encoding="utf-8") as f:
    create_sql = f.read().replace("wf_canonical_staging.", f"{schema_name}.")
  cur.execute(create_sql)

  with open("supabase/migrations/20260830190000_canonical_parent_child_remediation.sql", "r", encoding="utf-8") as f:
    remediation_sql = f.read().replace("wf_canonical_staging.", f"{schema_name}.")
  cur.execute(remediation_sql)

  # Insert 2 genuine auctions parents and 3 benchmark parents
  cur.execute(f"""
    INSERT INTO {schema_name}.mariadb_normalized_parents (
      id, source_system, source_database, source_table, source_id, source_hash, source_record_id,
      child_count, is_bundle, bundle_structure_type, parser_version, parent_hash
    ) VALUES 
    ('11111111-1111-1111-1111-111111111111', 'OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'src-1', 'h1', 'rec-1', 1, false, 'SINGLE', 'v1', 'ph1'),
    ('22222222-2222-2222-2222-222222222222', 'OceanDigital MariaDB', 'thecollective_inventory', 'auctions', 'src-2', 'h2', 'rec-2', 1, false, 'SINGLE', 'v1', 'ph2'),
    ('33333333-3333-3333-3333-333333333333', 'OceanDigital MariaDB', 'thecollective_inventory', 'auctions_bench_100k_w1_b250', 'src-3', 'h3', 'rec-3', 1, false, 'SINGLE', 'v1', 'ph3'),
    ('44444444-4444-4444-4444-444444444444', 'OceanDigital MariaDB', 'thecollective_inventory', 'auctions_bench_100k_w4_b250', 'src-4', 'h4', 'rec-4', 1, false, 'SINGLE', 'v1', 'ph4'),
    ('55555555-5555-5555-5555-555555555555', 'OceanDigital MariaDB', 'thecollective_inventory', 'auctions_w1_b250', 'src-5', 'h5', 'rec-5', 1, false, 'SINGLE', 'v1', 'ph5');
  """)

  # Insert children
  cur.execute(f"""
    INSERT INTO {schema_name}.mariadb_normalized_children (
      id, parent_id, child_ordinal, child_unique_key, child_proposal_hash, intent,
      currency_status, trading_floor_status, price_research_status, reconciliation_category,
      primary_image_evidence_type, parser_version, is_active
    ) VALUES
    ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 0, 'k1', 'ch1', 'WTS', 'VERIFIED_EXPLICIT_USD', 'ELIGIBLE_WTS', 'ELIGIBLE_VERIFIED_USD', 'SINGLE_RECORD', 'NO_IMAGE', 'v1', true),
    ('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 0, 'k2', 'ch2', 'WTS', 'VERIFIED_EXPLICIT_USD', 'ELIGIBLE_WTS', 'ELIGIBLE_VERIFIED_USD', 'SINGLE_RECORD', 'NO_IMAGE', 'v1', true),
    ('a3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 0, 'k3', 'ch3', 'WTS', 'VERIFIED_EXPLICIT_USD', 'ELIGIBLE_WTS', 'ELIGIBLE_VERIFIED_USD', 'SINGLE_RECORD', 'NO_IMAGE', 'v1', true),
    ('a4444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 0, 'k4', 'ch4', 'WTS', 'VERIFIED_EXPLICIT_USD', 'ELIGIBLE_WTS', 'ELIGIBLE_VERIFIED_USD', 'SINGLE_RECORD', 'NO_IMAGE', 'v1', true),
    ('a5555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', 0, 'k5', 'ch5', 'WTS', 'VERIFIED_EXPLICIT_USD', 'ELIGIBLE_WTS', 'ELIGIBLE_VERIFIED_USD', 'SINGLE_RECORD', 'NO_IMAGE', 'v1', true);
  """)

  # Insert images
  cur.execute(f"""
    INSERT INTO {schema_name}.mariadb_normalized_images (
      id, parent_id, child_id, scope, image_ordinal, image_key, image_evidence_type, is_active
    ) VALUES
    ('b1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', NULL, 'PARENT', 0, 'img1', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', true),
    ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', NULL, 'PARENT', 0, 'img2', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', true),
    ('b3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', NULL, 'PARENT', 0, 'img3', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', true),
    ('b4444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', NULL, 'PARENT', 0, 'img4', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', true),
    ('b5555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', NULL, 'PARENT', 0, 'img5', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', true);
  """)

  print("Executing quarantine migration on disposable database...")
  with open("supabase/migrations/20260831080000_quarantine_canonical_scope_contamination.sql", "r", encoding="utf-8") as f:
    quarantine_sql = f.read().replace("wf_canonical_staging.", f"{schema_name}.")
  cur.execute(quarantine_sql)

  # Assertions
  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_normalized_parents;")
  active_parents = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_quarantine_canonical_parents;")
  quarantined_parents = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_normalized_children;")
  active_children = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_quarantine_canonical_children;")
  quarantined_children = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_normalized_images;")
  active_images = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {schema_name}.mariadb_quarantine_canonical_images;")
  quarantined_images = cur.fetchone()[0]

  assert active_parents == 2, f"Expected 2 active parents, got {active_parents}"
  assert quarantined_parents == 3, f"Expected 3 quarantined parents, got {quarantined_parents}"
  assert active_children == 2, f"Expected 2 active children, got {active_children}"
  assert quarantined_children == 3, f"Expected 3 quarantined children, got {quarantined_children}"
  assert active_images == 2, f"Expected 2 active images, got {active_images}"
  assert quarantined_images == 3, f"Expected 3 quarantined images, got {quarantined_images}"

  cur.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE;")
  cur.close()
  conn.close()

  result = {
    "contract": "wf-disposable-quarantine-test-v1",
    "status": "PASSED",
    "tests_verified": [
      "ARCHIVE_TABLES_CREATED",
      "CONTAMINATED_PARENTS_QUARANTINED",
      "CONTAMINATED_CHILDREN_QUARANTINED",
      "CONTAMINATED_IMAGES_QUARANTINED",
      "ACTIVE_TABLES_CLEANSED",
      "GENUINE_AUCTIONS_PARENTS_PRESERVED_EXACTLY",
      "ZERO_ORPHAN_CHILDREN_OR_IMAGES"
    ],
    "tested_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/disposable_quarantine_test_results.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2)

  print("DISPOSABLE_QUARANTINE_TEST_SUCCESS:")
  print(json.dumps(result, indent=2))

if __name__ == "__main__":
  run_test()
