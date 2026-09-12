-- Phase 6: Trading Floor vs Price Research surface contract separation.
-- Forward-only, idempotent. Preserves existing view columns and grants
-- (CREATE OR REPLACE VIEW keeps column list and ACLs intact).
--
-- 1. Trading Floor must never present a bundle parent as an individual offer
--    once accepted (published) children exist for it.
-- 2. Price Research admission is qualified WTS only: the ready view hard-filters
--    intent = 'WTS' instead of relying solely on the price_research_eligible flag.
BEGIN;

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
WHERE NOT (
  v.is_bundle IS TRUE
  AND v.parent_listing_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c
    WHERE c.parent_listing_id = v.listing_id
  )
);

CREATE OR REPLACE VIEW public.price_research_ready_view_v2
WITH (security_invoker = true) AS
SELECT *
FROM public.trading_floor_ready_view_v2 v
WHERE v.intent = 'WTS'
  AND v.price_research_eligible IS TRUE
  AND v.price_usd > 0
  AND (
    upper(v.original_price_currency) = 'USD'
    OR (
      upper(v.original_price_currency) <> 'USD'
      AND v.fx_rate > 0
      AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
      AND v.fx_date IS NOT NULL
    )
  );

COMMIT;
