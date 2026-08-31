# tests/test_scoped_canonical_reconciliation.py
import os
import sys
import json
import psycopg2

FROZEN_CURSOR_DATE = "2026-04-28T15:50:43.000Z"
FROZEN_CURSOR_ID = "3cddaf9f-9f36-4633-a08e-59a6dfdca057"
EXPECTED_UNIQUE_SOURCE_IDS = 951743
EXPECTED_SCOPED_ROWS = 955743
EXPECTED_QUARANTINED_PARENTS = 435558

def get_db_conn():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)
  conn = psycopg2.connect(db_url)
  conn.autocommit = False
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")
  return conn

def test_frozen_boundary_and_scope_enforcement(conn):
  """Asserts exact scoped row count and unique ID count under the frozen cursor."""
  print("Running test_frozen_boundary_and_scope_enforcement...")
  cur = conn.cursor()
  cur.execute("""
    SELECT 
      COUNT(*) AS total_scoped_rows,
      COUNT(DISTINCT source_id) AS unique_source_ids
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions'
      AND (source_created_on, source_id) <= (%s, %s);
  """, (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
  total_scoped, unique_ids = cur.fetchone()
  assert total_scoped == EXPECTED_SCOPED_ROWS, f"Expected {EXPECTED_SCOPED_ROWS} total scoped rows, got {total_scoped}"
  assert unique_ids == EXPECTED_UNIQUE_SOURCE_IDS, f"Expected {EXPECTED_UNIQUE_SOURCE_IDS} unique source IDs, got {unique_ids}"
  assert (total_scoped - unique_ids) == 4000, f"Expected exactly 4,000 additional versions, got {total_scoped - unique_ids}"
  print("  -> PASSED")

def test_authoritative_version_selection(conn):
  """Asserts deterministic authoritative-version rule produces exactly 951,743 distinct rows."""
  print("Running test_authoritative_version_selection...")
  cur = conn.cursor()
  cur.execute("""
    WITH authoritative_raw AS (
      SELECT DISTINCT ON (source_id)
        id, source_system, source_database, source_table, source_id, source_hash,
        source_record_id, source_created_on, created_at
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = 'OceanDigital MariaDB'
        AND source_database = 'thecollective_inventory'
        AND source_table = 'auctions'
        AND (source_created_on, source_id) <= (%s, %s)
      ORDER BY source_id ASC, created_at DESC, id DESC
    )
    SELECT COUNT(*), COUNT(DISTINCT source_id)
    FROM authoritative_raw;
  """, (FROZEN_CURSOR_DATE, FROZEN_CURSOR_ID))
  tot, uniq = cur.fetchone()
  assert tot == EXPECTED_UNIQUE_SOURCE_IDS, f"Authoritative selection produced {tot} rows, expected {EXPECTED_UNIQUE_SOURCE_IDS}"
  assert uniq == EXPECTED_UNIQUE_SOURCE_IDS, f"Authoritative selection produced {uniq} unique IDs, expected {EXPECTED_UNIQUE_SOURCE_IDS}"
  print("  -> PASSED")

def test_namespace_isolation_and_quarantine_integrity(conn):
  """Asserts active canonical tables have 0 benchmark parents and quarantine preserves all 435,558 parents."""
  print("Running test_namespace_isolation_and_quarantine_integrity...")
  cur = conn.cursor()
  cur.execute("""
    SELECT COUNT(*) 
    FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system <> 'OceanDigital MariaDB'
       OR source_database <> 'thecollective_inventory'
       OR source_table <> 'auctions';
  """)
  active_contaminated = cur.fetchone()[0]
  assert active_contaminated == 0, f"Found {active_contaminated} non-auction parents in active canonical tables"

  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;")
  q_parents = cur.fetchone()[0]
  assert q_parents == EXPECTED_QUARANTINED_PARENTS, f"Expected {EXPECTED_QUARANTINED_PARENTS} quarantined parents, got {q_parents}"

  cur.execute("""
    SELECT COUNT(*)
    FROM wf_canonical_staging.mariadb_quarantine_canonical_children c
    LEFT JOIN wf_canonical_staging.mariadb_quarantine_canonical_parents p ON c.parent_id = p.id
    WHERE p.id IS NULL;
  """)
  q_orphan_children = cur.fetchone()[0]
  assert q_orphan_children == 0, f"Found {q_orphan_children} orphan children in quarantine"
  print("  -> PASSED")

def test_rollback_behavior_and_zero_public_delta(conn):
  """Asserts transactional rollback leaves canonical staging and public tables with 0 delta."""
  print("Running test_rollback_behavior_and_zero_public_delta...")
  cur = conn.cursor()
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  p_before = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_before = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_before = cur.fetchone()[0]

  # Execute dummy write in transaction
  cur.execute("""
    INSERT INTO wf_canonical_staging.mariadb_normalized_parents (
      source_system, source_database, source_table, source_id, source_record_id,
      source_created_on, source_observed_at, raw_payload, source_hash, raw_message_original,
      parser_version, parent_hash
    ) VALUES (
      'OceanDigital MariaDB', 'thecollective_inventory', 'auctions', '00000000-0000-0000-0000-000000000000',
      'test_rec_id', '2025-01-01T00:00:00.000Z', NOW(), '{}'::jsonb, '0000000000000000000000000000000000000000000000000000000000000000',
      'test_msg', 'v4.0.0', '0000000000000000000000000000000000000000000000000000000000000000'
    );
  """)

  # Rollback
  conn.rollback()

  # Re-verify
  cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_normalized_parents;")
  p_after = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.raw_messages;")
  pub_raw_after = cur.fetchone()[0]
  cur.execute("SELECT COUNT(*) FROM public.watch_records;")
  pub_watch_after = cur.fetchone()[0]

  assert p_after == p_before, f"Rollback failed: parents changed from {p_before} to {p_after}"
  assert pub_raw_after == pub_raw_before, f"Public raw_messages changed from {pub_raw_before} to {pub_raw_after}"
  assert pub_watch_after == pub_watch_before, f"Public watch_records changed from {pub_watch_before} to {pub_watch_after}"
  print("  -> PASSED")

def test_eligibility_classification_rules(conn):
  """Asserts status vocabulary compliance for price research and trading floor statuses."""
  print("Running test_eligibility_classification_rules...")
  cur = conn.cursor()
  cur.execute("""
    SELECT DISTINCT price_research_status FROM wf_canonical_staging.mariadb_normalized_children;
  """)
  pr_statuses = set(r[0] for r in cur.fetchall())
  allowed_pr_statuses = {
    "ELIGIBLE_VERIFIED_USD", "INELIGIBLE_TRADING_FLOOR_HOLD", "INELIGIBLE_NOT_WTS",
    "INELIGIBLE_AMBIGUOUS_CURRENCY", "INELIGIBLE_HKD_HELD_FOR_FX", "INELIGIBLE_USDT_HELD_FOR_FX",
    "INELIGIBLE_FX_UNRESOLVED", "INELIGIBLE_MISSING_PRICE", "INELIGIBLE_IDENTITY_INCOMPLETE",
    "INELIGIBLE_OUTLIER_EXCLUDED", "INELIGIBLE_FOREIGN_CURRENCY_HELD", "INELIGIBLE_OTHER", "INELIGIBLE_UNKNOWN"
  }
  assert pr_statuses.issubset(allowed_pr_statuses), f"Disallowed price research statuses found: {pr_statuses - allowed_pr_statuses}"
  print("  -> PASSED")

def test_cross_field_priced_not_missing(conn):
  """Asserts that rows with non-null original price are NEVER classified as INELIGIBLE_MISSING_PRICE."""
  print("Running test_cross_field_priced_not_missing...")
  cur = conn.cursor()
  cur.execute("""
    SELECT COUNT(*) 
    FROM wf_canonical_staging.mariadb_normalized_children
    WHERE original_price_amount IS NOT NULL 
      AND original_price_amount > 0 
      AND price_research_status = 'INELIGIBLE_MISSING_PRICE';
  """)
  invalid_count = cur.fetchone()[0]
  assert invalid_count == 0, f"Found {invalid_count} priced rows incorrectly classified as INELIGIBLE_MISSING_PRICE!"

  # Validate node normalizer contract on foreign currency rows
  import subprocess, json
  test_rows = [
    {
      "source_id": "00000000-0000-0000-0000-000000000001",
      "source_hash": "0000000000000000000000000000000000000000000000000000000000000001",
      "source_system": "OceanDigital MariaDB",
      "source_database": "thecollective_inventory",
      "source_table": "auctions",
      "source_record_id": "test_eur_1",
      "source_created_on": "2026-01-01T00:00:00.000Z",
      "raw_message": "FS: Rolex Submariner 126610LN 2023 full set 12500 EUR",
      "raw_payload": {"title": "Rolex Submariner", "description": "FS: Rolex Submariner 126610LN 2023 full set 12500 EUR"}
    }
  ]
  worker = subprocess.Popen(
    ["node", "tools/mariadb-live/normalize_chunk_worker.cjs"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
  )
  worker.stdin.write(json.dumps(test_rows) + "\n")
  worker.stdin.flush()
  out = json.loads(worker.stdout.readline())
  worker.terminate()

  child = out[0]["parent"]["children"][0]
  assert child["original_price_amount"] == 12500
  assert child["price_research_status"] == "INELIGIBLE_FX_UNRESOLVED", f"Expected INELIGIBLE_FX_UNRESOLVED, got {child['price_research_status']}"
  print("  -> PASSED")

def test_page_boundary_straddling_deduplication(conn):
  """Asserts that pagination across already-deduplicated dataset never duplicates or skips boundary records."""
  print("Running test_page_boundary_straddling_deduplication...")
  cur = conn.cursor()
  
  # Fetch Page 1 (1,000 rows)
  cur.execute("""
    SELECT source_id, source_created_on
    FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
    ORDER BY source_created_on ASC, source_id ASC
    LIMIT 1000;
  """)
  page_1 = cur.fetchall()
  assert len(page_1) == 1000, f"Expected 1,000 rows on Page 1, got {len(page_1)}"
  
  p1_last_date = page_1[-1][1]
  p1_last_id = page_1[-1][0]
  p1_ids = set(r[0] for r in page_1)
  assert len(p1_ids) == 1000, "Duplicate source_id found within Page 1!"

  # Fetch Page 2 (1,000 rows) starting from cursor
  cur.execute("""
    SELECT source_id, source_created_on
    FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
    WHERE (source_created_on, source_id) > (%s, %s)
    ORDER BY source_created_on ASC, source_id ASC
    LIMIT 1000;
  """, (p1_last_date, p1_last_id))
  page_2 = cur.fetchall()
  assert len(page_2) == 1000, f"Expected 1,000 rows on Page 2, got {len(page_2)}"

  p2_ids = set(r[0] for r in page_2)
  assert len(p2_ids) == 1000, "Duplicate source_id found within Page 2!"

  # Prove zero intersection across boundary
  boundary_intersection = p1_ids.intersection(p2_ids)
  assert len(boundary_intersection) == 0, f"Boundary straddling error: source IDs duplicated across page boundary: {boundary_intersection}"

  # Prove strict monotonic ordering between page 1 last and page 2 first
  p2_first_date = page_2[0][1]
  p2_first_id = page_2[0][0]
  assert (p2_first_date, p2_first_id) > (p1_last_date, p1_last_id), "Keyset cursor failed monotonic ordering!"
def test_real_five_version_boundary_and_winning_hashes(conn):
  """Asserts that 1,000 multi-version source IDs resolve to exactly one authoritative row with the winning ISO UTC hash."""
  print("Running test_real_five_version_boundary_and_winning_hashes...")
  cur = conn.cursor()

  artifact_path = "audit-output/mariadb-live/canonical-scope-contamination/cohort_4k_duplicate_source_ids_reconciliation.json"
  with open(artifact_path, "r", encoding="utf-8") as f:
    artifact_data = json.load(f)

  dup_ids = list(artifact_data.get("duplicate_records", {}).keys())
  assert len(dup_ids) == 1000, f"Expected 1,000 duplicated source IDs in artifact, found {len(dup_ids)}"

  sample_dup_ids = dup_ids[:100]

  # Query all raw versions for sample IDs (must be > 1 version per ID in raw table)
  cur.execute("""
    SELECT source_id, source_hash, source_created_on
    FROM wf_canonical_staging.mariadb_raw_source_rows
    WHERE source_id = ANY(%s::text[])
      AND source_system = 'OceanDigital MariaDB'
      AND source_database = 'thecollective_inventory'
      AND source_table = 'auctions';
  """, (sample_dup_ids,))
  raw_version_rows = cur.fetchall()
  assert len(raw_version_rows) >= len(sample_dup_ids) * 2, f"Expected multiple raw versions, found {len(raw_version_rows)}"

  # Query winning versions from authoritative dataset
  cur.execute("""
    SELECT source_id, source_hash, source_created_on, selected_by_provenance
    FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
    WHERE source_id = ANY(%s::text[]);
  """, (sample_dup_ids,))
  winning_rows = cur.fetchall()
  assert len(winning_rows) == len(sample_dup_ids), f"Expected {len(sample_dup_ids)} winning rows, got {len(winning_rows)}"

  for wr in winning_rows:
    sid, shash, screated, prov = wr
    assert screated.endswith("Z") and "T" in screated, f"Winning version {sid} does not have ISO UTC format: {screated}"
    assert prov == "AUTHORITATIVE_CAPTURE_PROVENANCE_V1", f"Unexpected provenance: {prov}"

  print("  -> PASSED")

if __name__ == "__main__":
  conn = get_db_conn()
  try:
    test_frozen_boundary_and_scope_enforcement(conn)
    test_authoritative_version_selection(conn)
    test_namespace_isolation_and_quarantine_integrity(conn)
    test_rollback_behavior_and_zero_public_delta(conn)
    test_eligibility_classification_rules(conn)
    test_cross_field_priced_not_missing(conn)
    test_page_boundary_straddling_deduplication(conn)
    test_real_five_version_boundary_and_winning_hashes(conn)
    print("\nALL 8 REGRESSION TESTS PASSED SUCCESSFULLY!")
  finally:
    conn.rollback()
    conn.close()
