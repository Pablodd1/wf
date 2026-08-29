-- Match the bounded broad Trading Floor RPC when a customer selects WTS/WTB.
-- The previous broad-brand index could not satisfy the expression predicate,
-- making the cold Rolex WTB lane exceed the hosted statement timeout.

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_release_brand_intent_feed
  ON staging.listings (
    brand_normalized,
    (upper(COALESCE(listing_type, intent, ''))),
    created_at DESC,
    id DESC
  )
  INCLUDE (normalization_run_key, reference_normalized, price_usd, dial_color_normalized)
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

ANALYZE staging.listings;
