-- supabase/migrations/20260831080000_quarantine_canonical_scope_contamination.sql
-- Transactional quarantine and cleanup of non-auctions benchmark namespace records from active canonical tables.

DO $$
DECLARE
  v_non_auction_parents_count BIGINT;
  v_archived_parents_count BIGINT;
  v_non_auction_children_count BIGINT;
  v_archived_children_count BIGINT;
  v_non_auction_images_count BIGINT;
  v_archived_images_count BIGINT;
  v_remaining_non_auction_parents BIGINT;
  v_remaining_orphan_children BIGINT;
  v_remaining_orphan_images BIGINT;
BEGIN
  -- 1. Create quarantine archive tables preserving lineage and columns
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

  -- 2. Count non-auctions contaminated records before archive
  SELECT COUNT(*) INTO v_non_auction_parents_count
  FROM wf_canonical_staging.mariadb_normalized_parents
  WHERE source_table <> 'auctions'
     OR source_system <> 'OceanDigital MariaDB'
     OR source_database <> 'thecollective_inventory';

  SELECT COUNT(*) INTO v_non_auction_children_count
  FROM wf_canonical_staging.mariadb_normalized_children c
  JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
  WHERE p.source_table <> 'auctions'
     OR p.source_system <> 'OceanDigital MariaDB'
     OR p.source_database <> 'thecollective_inventory';

  SELECT COUNT(*) INTO v_non_auction_images_count
  FROM wf_canonical_staging.mariadb_normalized_images img
  JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
  WHERE p.source_table <> 'auctions'
     OR p.source_system <> 'OceanDigital MariaDB'
     OR p.source_database <> 'thecollective_inventory';

  -- 3. Archive contaminated parents
  INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_parents
  SELECT
    p.*,
    NOW() AS quarantined_at,
    'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION' AS quarantine_reason
  FROM wf_canonical_staging.mariadb_normalized_parents p
  WHERE p.source_table <> 'auctions'
     OR p.source_system <> 'OceanDigital MariaDB'
     OR p.source_database <> 'thecollective_inventory'
  ON CONFLICT (id) DO NOTHING;

  -- 4. Archive contaminated children
  INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_children
  SELECT
    c.*,
    NOW() AS quarantined_at,
    'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION' AS quarantine_reason
  FROM wf_canonical_staging.mariadb_normalized_children c
  JOIN wf_canonical_staging.mariadb_quarantine_canonical_parents p ON c.parent_id = p.id
  ON CONFLICT (id) DO NOTHING;

  -- 5. Archive contaminated images
  INSERT INTO wf_canonical_staging.mariadb_quarantine_canonical_images
  SELECT
    img.*,
    NOW() AS quarantined_at,
    'BENCHMARK_NAMESPACE_SCOPE_CONTAMINATION' AS quarantine_reason
  FROM wf_canonical_staging.mariadb_normalized_images img
  JOIN wf_canonical_staging.mariadb_quarantine_canonical_parents p ON img.parent_id = p.id
  ON CONFLICT (id) DO NOTHING;

  -- 6. Verify exact archive readback in transaction
  SELECT COUNT(*) INTO v_archived_parents_count
  FROM wf_canonical_staging.mariadb_quarantine_canonical_parents;

  SELECT COUNT(*) INTO v_archived_children_count
  FROM wf_canonical_staging.mariadb_quarantine_canonical_children;

  SELECT COUNT(*) INTO v_archived_images_count
  FROM wf_canonical_staging.mariadb_quarantine_canonical_images;

  IF v_archived_parents_count < v_non_auction_parents_count THEN
    RAISE EXCEPTION 'QUARANTINE_READBACK_FAILURE: Expected % archived parents, got %', v_non_auction_parents_count, v_archived_parents_count;
  END IF;

  IF v_archived_children_count < v_non_auction_children_count THEN
    RAISE EXCEPTION 'QUARANTINE_READBACK_FAILURE: Expected % archived children, got %', v_non_auction_children_count, v_archived_children_count;
  END IF;

  IF v_archived_images_count < v_non_auction_images_count THEN
    RAISE EXCEPTION 'QUARANTINE_READBACK_FAILURE: Expected % archived images, got %', v_non_auction_images_count, v_archived_images_count;
  END IF;

  -- 7. Remove quarantined rows from active canonical tables
  DELETE FROM wf_canonical_staging.mariadb_normalized_images
  WHERE parent_id IN (SELECT id FROM wf_canonical_staging.mariadb_quarantine_canonical_parents);

  DELETE FROM wf_canonical_staging.mariadb_normalized_children
  WHERE parent_id IN (SELECT id FROM wf_canonical_staging.mariadb_quarantine_canonical_parents);

  DELETE FROM wf_canonical_staging.mariadb_normalized_parents
  WHERE id IN (SELECT id FROM wf_canonical_staging.mariadb_quarantine_canonical_parents);

  -- 8. Post-cleanup assertions
  SELECT COUNT(*) INTO v_remaining_non_auction_parents
  FROM wf_canonical_staging.mariadb_normalized_parents
  WHERE source_table <> 'auctions'
     OR source_system <> 'OceanDigital MariaDB'
     OR source_database <> 'thecollective_inventory';

  IF v_remaining_non_auction_parents > 0 THEN
    RAISE EXCEPTION 'QUARANTINE_POST_ASSERTION_FAILURE: % non-auctions parents still remain in active table', v_remaining_non_auction_parents;
  END IF;

  SELECT COUNT(*) INTO v_remaining_orphan_children
  FROM wf_canonical_staging.mariadb_normalized_children c
  LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
  WHERE p.id IS NULL;

  IF v_remaining_orphan_children > 0 THEN
    RAISE EXCEPTION 'QUARANTINE_POST_ASSERTION_FAILURE: % orphan children found after quarantine delete', v_remaining_orphan_children;
  END IF;

  SELECT COUNT(*) INTO v_remaining_orphan_images
  FROM wf_canonical_staging.mariadb_normalized_images img
  LEFT JOIN wf_canonical_staging.mariadb_normalized_parents p ON img.parent_id = p.id
  WHERE p.id IS NULL;

  IF v_remaining_orphan_images > 0 THEN
    RAISE EXCEPTION 'QUARANTINE_POST_ASSERTION_FAILURE: % orphan images found after quarantine delete', v_remaining_orphan_images;
  END IF;

  RAISE NOTICE 'QUARANTINE_CLEANUP_SUCCESS: Archived and removed % parents, % children, % images.',
    v_non_auction_parents_count, v_non_auction_children_count, v_non_auction_images_count;
END $$;
