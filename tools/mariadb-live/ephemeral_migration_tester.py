# tools/mariadb-live/ephemeral_migration_tester.py
import os
import sys
import psycopg2
import json
import uuid
import datetime

PROD_IDENTIFIERS = [
  "bptrvfncppbjnchsaxtb",
  "aws-0-us-west-1.pooler.supabase.com"
]

def run_ephemeral_migration_tests():
  ephemeral_url = os.environ.get("EPHEMERAL_DATABASE_URL")
  prod_url = os.environ.get("DATABASE_URL")

  if not ephemeral_url:
    print("FATAL: EPHEMERAL_DATABASE_URL is required to run the migration test suite.", file=sys.stderr)
    print("Migration tester must NEVER run against production DATABASE_URL.", file=sys.stderr)
    print("Please provide a disposable local PostgreSQL database or Supabase preview branch.", file=sys.stderr)
    sys.exit(1)

  for prod_id in PROD_IDENTIFIERS:
    if prod_id in ephemeral_url:
      print(f"FATAL: PRODUCTION_TARGET_REJECTED: EPHEMERAL_DATABASE_URL contains production identifier '{prod_id}'.", file=sys.stderr)
      sys.exit(1)

  if prod_url and ephemeral_url == prod_url:
    print("FATAL: PRODUCTION_TARGET_REJECTED: EPHEMERAL_DATABASE_URL is identical to production DATABASE_URL.", file=sys.stderr)
    sys.exit(1)

  print(f"Connecting to verified disposable database...")
  conn = psycopg2.connect(ephemeral_url)
  conn.autocommit = True
  cur = conn.cursor()

  test_schema = f"ephemeral_test_{uuid.uuid4().hex[:8]}"
  print(f"Creating isolated ephemeral test schema: {test_schema}...")

  cur.execute(f"CREATE SCHEMA {test_schema};")

  # 1. Build Preceding Base Schema
  cur.execute(f"""
    SET search_path = {test_schema}, pg_catalog;

    CREATE TABLE {test_schema}.mariadb_normalized_parents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_system TEXT DEFAULT 'mariadb_auctions',
      source_database TEXT DEFAULT 'thecollective_inventory',
      source_table TEXT DEFAULT 'auctions',
      source_id TEXT,
      source_hash TEXT,
      source_record_id TEXT,
      source_created_on TEXT,
      source_observed_at TEXT,
      posted_at TEXT,
      raw_message_original TEXT,
      listing_text_source TEXT,
      listing_text_sha256 TEXT,
      raw_payload JSONB DEFAULT '{{}}'::jsonb,
      is_bundle BOOLEAN DEFAULT FALSE,
      child_count INT DEFAULT 1,
      bundle_structure_type TEXT DEFAULT 'SINGLE',
      seller_name TEXT,
      seller_contact TEXT,
      contact_publication_approved BOOLEAN DEFAULT FALSE,
      seller_activity_count INT DEFAULT 0,
      seller_rating NUMERIC,
      seller_rating_status TEXT DEFAULT 'UNVERIFIED_NO_PUBLIC_REVIEWS',
      seller_review_evidence TEXT,
      location TEXT,
      parser_version TEXT DEFAULT 'v1',
      parent_hash TEXT,
      review_flags TEXT[] DEFAULT ARRAY[]::text[],
      normalized_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE {test_schema}.mariadb_normalized_children (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id UUID REFERENCES {test_schema}.mariadb_normalized_parents(id) ON DELETE CASCADE,
      parent_source_id TEXT,
      parent_source_hash TEXT,
      child_ordinal INT NOT NULL DEFAULT 0,
      child_unique_key TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      reference TEXT,
      dial_color TEXT,
      year INT,
      condition TEXT,
      intent TEXT,
      original_price_amount NUMERIC,
      original_price_currency TEXT,
      currency_evidence TEXT,
      price_usd NUMERIC,
      fx_rate NUMERIC,
      fx_source TEXT,
      fx_date TEXT,
      currency_status TEXT,
      is_outlier BOOLEAN DEFAULT FALSE,
      outlier_reason TEXT,
      primary_image_key TEXT,
      primary_image_url TEXT,
      primary_image_evidence_type TEXT,
      trading_floor_status TEXT,
      trading_floor_eligible BOOLEAN DEFAULT FALSE,
      price_research_status TEXT,
      price_research_eligible BOOLEAN DEFAULT FALSE,
      reconciliation_category TEXT,
      review_flags TEXT[] DEFAULT ARRAY[]::text[],
      exclusion_reasons TEXT[] DEFAULT ARRAY[]::text[],
      parser_version TEXT DEFAULT 'v1',
      child_proposal_hash TEXT,
      normalized_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE {test_schema}.mariadb_normalized_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id UUID REFERENCES {test_schema}.mariadb_normalized_parents(id) ON DELETE CASCADE,
      child_id UUID,
      scope TEXT DEFAULT 'CHILD',
      image_ordinal INT DEFAULT 0,
      image_key TEXT NOT NULL,
      image_url TEXT,
      image_evidence_type TEXT,
      parser_version TEXT DEFAULT 'v1',
      is_active BOOLEAN DEFAULT TRUE,
      superseded_at TIMESTAMPTZ
    );

    CREATE TABLE {test_schema}.mariadb_raw_source_rows (
      source_id TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_database TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_created_on TIMESTAMPTZ,
      raw_message TEXT,
      raw_payload JSONB,
      PRIMARY KEY (source_system, source_database, source_table, source_id, source_hash)
    );
  """)

  # 2. Read and Adapt Migration SQL to Ephemeral Schema
  with open("supabase/migrations/20260830190000_canonical_parent_child_remediation.sql", "r", encoding="utf-8") as f:
    migration_sql = f.read()

  # Replace schema references for isolated ephemeral execution
  ephemeral_migration_sql = migration_sql.replace("wf_canonical_staging", test_schema)
  ephemeral_migration_sql = ephemeral_migration_sql.replace("public.upsert_mariadb_canonical_batch", f"{test_schema}.upsert_mariadb_canonical_batch")
  ephemeral_migration_sql = ephemeral_migration_sql.replace("public.get_mariadb_canonical_child_detail", f"{test_schema}.get_mariadb_canonical_child_detail")
  ephemeral_migration_sql = ephemeral_migration_sql.replace("public.get_mariadb_canonical_internal_evidence", f"{test_schema}.get_mariadb_canonical_internal_evidence")

  print("Executing remediation migration on ephemeral schema...")
  cur.execute(ephemeral_migration_sql)
  print("Migration applied successfully to ephemeral schema.")

  test_results = []

  # TEST A: Initial Insert (Parent with 2 children, each with 2 images)
  payload_initial = [
    {
      "source_system": "mariadb_auctions",
      "source_database": "thecollective_inventory",
      "source_table": "auctions",
      "source_id": "test_ephemeral_source_1",
      "source_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "source_record_id": "ephemeral_rec_1",
      "source_created_on": "2026-08-30T12:00:00Z",
      "source_observed_at": "2026-08-30T12:00:00Z",
      "posted_at": "2026-08-30T12:00:00Z",
      "raw_message_original": "Rolex Submariner and Daytona Bundle",
      "listing_text_source": "Rolex Submariner and Daytona Bundle",
      "listing_text_sha256": "1111222233334444555566667777888899990000111122223333444455556666",
      "raw_payload": {"id": "ephemeral_rec_1"},
      "is_bundle": True,
      "child_count": 2,
      "bundle_structure_type": "MULTI_OFFER",
      "seller_name": "Ephemeral Dealer",
      "seller_contact": "+1 555 123 4567",
      "contact_publication_approved": True,
      "seller_activity_count": 10,
      "seller_rating": 4.9,
      "seller_rating_status": "EXPLICIT_SOURCE_REVIEWS",
      "seller_review_evidence": "10 positive reviews",
      "location": "New York, USA",
      "parser_version": "authoritative-canonical-v10-parent-child",
      "parent_hash": "9999888877776666555544443333222211110000999988887777666655554444",
      "review_flags": [],
      "children": [
        {
          "child_ordinal": 0,
          "child_unique_key": "test_ephemeral_source_1:0",
          "brand": "Rolex",
          "model": "Submariner Date",
          "reference": "116610LN",
          "dial_color": "Black",
          "year": 2018,
          "condition": "Mint",
          "intent": "WTS",
          "original_price_amount": 12500,
          "original_price_currency": "USD",
          "currency_evidence": "explicit_line_currency",
          "price_usd": 12500,
          "fx_rate": 1.0,
          "fx_source": "ECB",
          "fx_date": "2026-08-30",
          "currency_status": "VERIFIED_EXPLICIT_USD",
          "is_outlier": False,
          "outlier_reason": None,
          "primary_image_key": "listings/full/sub_front.jpg",
          "primary_image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/sub_front.jpg",
          "primary_image_evidence_type": "IMAGE_URL_VERIFIED",
          "trading_floor_status": "ELIGIBLE_WTS",
          "trading_floor_eligible": True,
          "price_research_status": "ELIGIBLE_VERIFIED_USD",
          "price_research_eligible": True,
          "reconciliation_category": "BUNDLE_ITEM",
          "review_flags": [],
          "exclusion_reasons": [],
          "child_proposal_hash": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "images": [
            {"image_ordinal": 0, "image_key": "listings/full/sub_front.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/sub_front.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"},
            {"image_ordinal": 1, "image_key": "listings/full/sub_back.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/sub_back.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"}
          ]
        },
        {
          "child_ordinal": 1,
          "child_unique_key": "test_ephemeral_source_1:1",
          "brand": "Rolex",
          "model": "Daytona",
          "reference": "116500LN",
          "dial_color": "White",
          "year": 2020,
          "condition": "Unworn",
          "intent": "WTS",
          "original_price_amount": 28000,
          "original_price_currency": "USD",
          "currency_evidence": "explicit_line_currency",
          "price_usd": 28000,
          "fx_rate": 1.0,
          "fx_source": "ECB",
          "fx_date": "2026-08-30",
          "currency_status": "VERIFIED_EXPLICIT_USD",
          "is_outlier": False,
          "outlier_reason": None,
          "primary_image_key": "listings/full/daytona_front.jpg",
          "primary_image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona_front.jpg",
          "primary_image_evidence_type": "IMAGE_URL_VERIFIED",
          "trading_floor_status": "ELIGIBLE_WTS",
          "trading_floor_eligible": True,
          "price_research_status": "ELIGIBLE_VERIFIED_USD",
          "price_research_eligible": True,
          "reconciliation_category": "BUNDLE_ITEM",
          "review_flags": [],
          "exclusion_reasons": [],
          "child_proposal_hash": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          "images": [
            {"image_ordinal": 0, "image_key": "listings/full/daytona_front.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona_front.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"},
            {"image_ordinal": 1, "image_key": "listings/full/daytona_box.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/daytona_box.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"}
          ]
        }
      ]
    }
  ]

  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_initial),))
  res_initial = cur.fetchone()[0]
  
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_parents;")
  p_count = cur.fetchone()[0]
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE;")
  c_active_count = cur.fetchone()[0]
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_images WHERE is_active = TRUE;")
  img_active_count = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_A_INITIAL_INSERT",
    "passed": res_initial["inserted_parents"] == 1 and res_initial["inserted_children"] == 2 and p_count == 1 and c_active_count == 2 and img_active_count == 4,
    "detail": f"Parents={p_count}, ActiveChildren={c_active_count}, ActiveImages={img_active_count}"
  })

  # TEST B: Identical Rerun (Idempotency)
  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_initial),))
  res_rerun = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_B_IDENTICAL_RERUN",
    "passed": res_rerun["inserted_parents"] == 0 and res_rerun["updated_parents"] == 0 and res_rerun["unchanged_parents"] == 1 and res_rerun["unchanged_children"] == 2,
    "detail": f"UnchangedParents={res_rerun['unchanged_parents']}, UnchangedChildren={res_rerun['unchanged_children']}"
  })

  # TEST C: Changed Child 0 (Price updated from 12500 to 13000)
  payload_changed_child = json.loads(json.dumps(payload_initial))
  payload_changed_child[0]["children"][0]["original_price_amount"] = 13000
  payload_changed_child[0]["children"][0]["price_usd"] = 13000
  payload_changed_child[0]["children"][0]["child_proposal_hash"] = "ffff567890abcdef1234567890abcdef1234567890abcdef1234567890ffffff"

  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_changed_child),))
  res_changed = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = FALSE;")
  c_inactive_count = cur.fetchone()[0]
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE;")
  c_active_after_change = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_C_CHANGED_CHILD_SUPERSESSION",
    "passed": res_changed["updated_children"] == 1 and res_changed["unchanged_children"] == 1 and c_inactive_count == 1 and c_active_after_change == 2,
    "detail": f"UpdatedChildren={res_changed['updated_children']}, InactiveChildren={c_inactive_count}, ActiveChildren={c_active_after_change}"
  })

  # TEST D: Removed Child (Child count reduced from 2 to 1)
  payload_removed_child = json.loads(json.dumps(payload_changed_child))
  payload_removed_child[0]["child_count"] = 1
  payload_removed_child[0]["children"] = [payload_removed_child[0]["children"][0]]

  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_removed_child),))
  res_removed = cur.fetchone()[0]

  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE;")
  c_active_after_removal = cur.fetchone()[0]
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = FALSE;")
  c_inactive_after_removal = cur.fetchone()[0]
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_images WHERE is_active = FALSE;")
  img_inactive_count = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_D_REMOVED_CHILD_IMAGE_DEACTIVATION",
    "passed": c_active_after_removal == 1 and c_inactive_after_removal == 2 and img_inactive_count >= 2,
    "detail": f"ActiveChildren={c_active_after_removal}, InactiveChildren={c_inactive_after_removal}, InactiveImages={img_inactive_count}"
  })

  # TEST E: Removed Image from Child (Reduce child 0 images from 2 to 1)
  payload_removed_img = json.loads(json.dumps(payload_removed_child))
  payload_removed_img[0]["children"][0]["images"] = [payload_removed_img[0]["children"][0]["images"][0]] # only sub_front.jpg

  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_removed_img),))
  
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_images WHERE is_active = TRUE AND child_id = (SELECT id FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE);")
  child0_active_images = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_E_REMOVED_IMAGE_SYNCHRONIZATION",
    "passed": child0_active_images == 1,
    "detail": f"Child0ActiveImages={child0_active_images} (historical row preserved as inactive)"
  })

  # TEST F: Image Ordinal Change Regression (Key changes ordinal from 0 to 1)
  payload_ordinal_change = json.loads(json.dumps(payload_removed_img))
  # Change ordinal of sub_front.jpg from 0 to 1, and add a new image at ordinal 0
  payload_ordinal_change[0]["children"][0]["images"] = [
    {"image_ordinal": 0, "image_key": "listings/full/new_front.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/new_front.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"},
    {"image_ordinal": 1, "image_key": "listings/full/sub_front.jpg", "image_url": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/sub_front.jpg", "image_evidence_type": "IMAGE_URL_VERIFIED"}
  ]

  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_ordinal_change),))

  # Verify (image_ordinal=0, image_key='listings/full/sub_front.jpg') is now inactive
  cur.execute(f"""
    SELECT is_active FROM {test_schema}.mariadb_normalized_images
    WHERE child_id = (SELECT id FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE)
      AND image_ordinal = 0 AND image_key = 'listings/full/sub_front.jpg';
  """)
  old_sub_front_active = cur.fetchone()[0]

  # Verify (image_ordinal=1, image_key='listings/full/sub_front.jpg') is now active
  cur.execute(f"""
    SELECT is_active FROM {test_schema}.mariadb_normalized_images
    WHERE child_id = (SELECT id FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE)
      AND image_ordinal = 1 AND image_key = 'listings/full/sub_front.jpg';
  """)
  new_sub_front_active = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_F_IMAGE_ORDINAL_CHANGE_REGRESSION",
    "passed": (old_sub_front_active is False) and (new_sub_front_active is True),
    "detail": f"OldOrdinal0Active={old_sub_front_active}, NewOrdinal1Active={new_sub_front_active}"
  })

  # TEST G: Parent Mandatory Children Array (missing/null/scalar must throw, [] intentionally removes all children)
  parent_missing_children_passed = False
  try:
    payload_bad_parent = json.loads(json.dumps(payload_initial))
    del payload_bad_parent[0]["children"]
    cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_bad_parent),))
  except psycopg2.errors.RaiseException as e:
    parent_missing_children_passed = "Every parent must contain a children JSON array" in str(e)

  payload_empty_children = json.loads(json.dumps(payload_initial))
  payload_empty_children[0]["child_count"] = 0
  payload_empty_children[0]["children"] = []
  cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_empty_children),))
  cur.execute(f"SELECT COUNT(*) FROM {test_schema}.mariadb_normalized_children WHERE is_active = TRUE;")
  active_children_after_empty = cur.fetchone()[0]

  test_results.append({
    "test": "TEST_G_PARENT_MANDATORY_CHILDREN_ARRAY",
    "passed": parent_missing_children_passed and active_children_after_empty == 0,
    "detail": f"MissingChildrenRejected={parent_missing_children_passed}, ActiveChildrenAfterEmpty={active_children_after_empty}"
  })

  # TEST H: Child Mandatory Images Array (missing/null/scalar must throw)
  child_missing_images_passed = False
  try:
    payload_bad_child = json.loads(json.dumps(payload_initial))
    del payload_bad_child[0]["children"][0]["images"]
    cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch(%s);", (json.dumps(payload_bad_child),))
  except psycopg2.errors.RaiseException as e:
    child_missing_images_passed = "Every child must contain an images JSON array" in str(e)

  test_results.append({
    "test": "TEST_H_CHILD_MANDATORY_IMAGES_ARRAY",
    "passed": child_missing_images_passed,
    "detail": f"MissingImagesRejected={child_missing_images_passed}"
  })

  # TEST I: Invalid Scope Constraints
  scope_test_passed = False
  try:
    cur.execute(f"""
      INSERT INTO {test_schema}.mariadb_normalized_images (
        parent_id, child_id, scope, image_ordinal, image_key, parser_version, is_active
      ) VALUES (
        (SELECT id FROM {test_schema}.mariadb_normalized_parents LIMIT 1),
        (SELECT id FROM {test_schema}.mariadb_normalized_children LIMIT 1),
        'PARENT',
        0,
        'listings/full/invalid_scope.jpg',
        'v1',
        TRUE
      );
    """)
  except psycopg2.errors.CheckViolation:
    scope_test_passed = True

  test_results.append({
    "test": "TEST_I_INVALID_SCOPE_CONSTRAINT",
    "passed": scope_test_passed,
    "detail": "chk_mariadb_images_scope_child_id successfully prevented PARENT scope with non-null child_id"
  })

  # TEST J: Malformed Batch JSON
  malformed_test_passed = False
  try:
    cur.execute(f"SELECT {test_schema}.upsert_mariadb_canonical_batch('\"not_an_array\"'::jsonb);")
  except psycopg2.errors.RaiseException:
    malformed_test_passed = True

  test_results.append({
    "test": "TEST_J_MALFORMED_ARRAYS_FAIL_CLOSED",
    "passed": malformed_test_passed,
    "detail": "upsert_mariadb_canonical_batch successfully rejected non-array JSONB batch"
  })

  # Cleanup Ephemeral Schema
  print(f"Cleaning up ephemeral test schema {test_schema}...")
  cur.execute(f"DROP SCHEMA {test_schema} CASCADE;")
  cur.close()
  conn.close()

  all_passed = all(t["passed"] for t in test_results)

  summary = {
    "contract": "wf-ephemeral-canonical-migration-tests-v2",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "status": "PASSED" if all_passed else "FAILED",
    "total_tests": len(test_results),
    "passed_tests": sum(1 for t in test_results if t["passed"]),
    "failed_tests": sum(1 for t in test_results if not t["passed"]),
    "test_cases": test_results
  }

  os.makedirs("audit-output/mariadb-live/canonical-canary-10k", exist_ok=True)
  with open("audit-output/mariadb-live/canonical-canary-10k/ephemeral_migration_test_results.json", "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

  print("EPHEMERAL_MIGRATION_TESTS_COMPLETE:")
  print(json.dumps(summary, indent=2))
  return summary

if __name__ == "__main__":
  run_ephemeral_migration_tests()
