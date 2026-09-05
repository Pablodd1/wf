-- Forward-only indexes for bounded QNSA Rolex/Patek customer reads.
-- The public release views join the enabled normalization run, so keeping the
-- run key first allows the planner to stop after the requested page instead of
-- sorting or scanning the full reconciled staging table.

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_brand_posted
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_reference_posted
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

ANALYZE staging.listings;
