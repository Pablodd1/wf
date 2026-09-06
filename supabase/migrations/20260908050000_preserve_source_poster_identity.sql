-- Approved dealer profiles must not replace the source poster identity used for repost deduplication.
BEGIN;
CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2 WITH(security_invoker=true) AS
SELECT
 v.contract_version AS contract_version,
 v.listing_id AS listing_id,
 v.parent_listing_id AS parent_listing_id,
 v.child_index AS child_index,
 v.source_id AS source_id,
 v.source_hash AS source_hash,
 v.raw_message_id AS raw_message_id,
 v.raw_message_text AS raw_message_text,
 v.source_context_text AS source_context_text,
 v.source_created_at AS source_created_at,
 v.observed_at AS observed_at,
 v.category AS category,
 v.brand AS brand,
 v.model AS model,
 v.reference AS reference,
 v.dial_color AS dial_color,
 v.year AS year,
 v.condition AS condition,
 v.intent AS intent,
 v.intent_status AS intent_status,
 v.title AS title,
 v.description AS description,
 v.original_price_text AS original_price_text,
 v.original_price_amount AS original_price_amount,
 v.original_price_currency AS original_price_currency,
 v.price_usd AS price_usd,
 v.fx_rate AS fx_rate,
 v.fx_source AS fx_source,
 v.fx_date AS fx_date,
 v.price_status AS price_status,
 v.price_research_eligible AS price_research_eligible,
 v.included_in_statistics AS included_in_statistics,
 v.statistics_exclusion_reason AS statistics_exclusion_reason,
 v.image_url AS image_url,
 v.thumbnail_url AS thumbnail_url,
 v.image_key AS image_key,
 v.image_evidence_type AS image_evidence_type,
 v.image_status AS image_status,
 v.seller_id AS seller_id,
 v.seller_display_name AS seller_display_name,
 d.profile_path AS seller_profile_url,
 d.review_count AS seller_review_count,
 v.seller_listing_count AS seller_listing_count,
 v.seller_wts_count AS seller_wts_count,
 v.seller_wtb_count AS seller_wtb_count,
 coalesce(d.contact_consent,false) AS contact_available,
 v.location_country AS location_country,
 v.location_region AS location_region,
 v.is_bundle AS is_bundle,
 v.bundle_child_count AS bundle_child_count,
 v.review_status AS review_status,
 v.review_reasons AS review_reasons,
 v.priced_rank AS priced_rank,
 v.image_rank AS image_rank,
 v.duplicate_group_id AS duplicate_group_id,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN d.rating ELSE NULL END AS seller_rating,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN 'SOURCE_SUPPLIED' WHEN d.review_count>0 THEN 'SOURCE_FEEDBACK_COUNT' ELSE 'UNAVAILABLE' END AS seller_rating_evidence_status
FROM (
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
WHERE v.is_bundle IS FALSE AND v.parent_listing_id IS NULL AND v.child_index IS NULL
) v LEFT JOIN wf_canonical_staging.v2_approved_listing_dealers d
 ON d.listing_id=v.listing_id AND d.source_id=v.source_id AND d.source_hash=v.source_hash;


UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
NOTIFY pgrst,'reload schema';
COMMIT;
