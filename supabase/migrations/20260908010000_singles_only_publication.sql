-- Current owner-authorized scope is singles only. Preserve all private bundle evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2
WITH (security_invoker = true) AS
SELECT
  contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
  raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
  category, brand, model, reference, dial_color, year, condition, intent, intent_status,
  title, description, original_price_text, original_price_amount, original_price_currency,
  price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
  included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
  image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
  seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
  contact_available, location_country, location_region, is_bundle, bundle_child_count,
  review_status, review_reasons,
  CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END AS priced_rank,
  CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
         AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END AS image_rank,
  duplicate_group_id
FROM wf_canonical_staging.mariadb_canary_published_listings_v2 v
WHERE v.is_bundle IS FALSE AND v.parent_listing_id IS NULL AND v.child_index IS NULL;

-- The dependent Price Research view inherits the same singles boundary.
-- New traversals must not reuse snapshots from the preceding publication policy.
UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
NOTIFY pgrst, 'reload schema';
COMMIT;
