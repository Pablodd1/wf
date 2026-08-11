-- Planner-usable newest-first QNSA feeds.
-- The v1 indexes pinned normalization_run_key in the partial predicate. The
-- public view obtains that key through a control-table join, so PostgreSQL could
-- not prove the predicate while planning a brand-only or unscoped REST query.
-- These indexes cover the same safe single-watch population without requiring
-- that cross-table inference; the view still enforces the enabled run key.

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_global_feed_v2
  ON staging.listings (created_at DESC, id DESC)
  INCLUDE (normalization_run_key, brand_normalized, reference_normalized, listing_type, price_usd, dial_color_normalized)
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_brand_feed_v2
  ON staging.listings (brand_normalized, created_at DESC, id DESC)
  INCLUDE (normalization_run_key, reference_normalized, listing_type, price_usd, dial_color_normalized)
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

ANALYZE staging.listings;
