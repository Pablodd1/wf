-- Prefix-family indexes for reviewed 116500* and 5712* customer queries.
-- text_pattern_ops lets PostgreSQL use the index for LIKE 'prefix%' under
-- non-C collations while retaining the immutable normalization-run boundary.

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_reference_family
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized text_pattern_ops
  )
  INCLUDE (created_at, id, listing_type, price_usd, dial_color_normalized)
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

ANALYZE staging.listings;
