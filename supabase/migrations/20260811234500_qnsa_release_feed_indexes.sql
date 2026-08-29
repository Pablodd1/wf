-- Bounded newest-first feeds for the reconciled QNSA Rolex/Patek release.
-- These intentionally omit normalization_run_key as a leading ORDER BY key:
-- the release view obtains that key through its control-table join, which did
-- not let PostgreSQL satisfy unscoped and brand-only customer page ordering
-- from the earlier run-key-first indexes.

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_global_feed
  ON staging.listings (created_at DESC, id DESC)
  INCLUDE (brand_normalized, reference_normalized, listing_type, price_usd, dial_color_normalized)
  WHERE normalization_run_key = 'mariadb-normalized-20260811-codex-v1'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_brand_feed
  ON staging.listings (brand_normalized, created_at DESC, id DESC)
  INCLUDE (reference_normalized, listing_type, price_usd, dial_color_normalized)
  WHERE normalization_run_key = 'mariadb-normalized-20260811-codex-v1'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

ANALYZE staging.listings;
