-- Migration: 20260807130000_fix_view_nulls_and_version_idempotency.sql
-- Description: Remove view defaults converting NULL category, listing_type, or status, and propagate media/version columns.

-- 1. Ensure columns exist on raw.payload_versions
ALTER TABLE raw.payload_versions ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE raw.payload_versions ADD COLUMN IF NOT EXISTS attachment_keys JSONB DEFAULT '[]'::jsonb;
ALTER TABLE raw.payload_versions ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE raw.payload_versions ADD COLUMN IF NOT EXISTS media_fingerprint TEXT;

-- 2. Recreate Trading Floor view without NULL coercions
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2 CASCADE;

CREATE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT 
    l.id,
    l.job_id,
    l.parent_id,
    l.bundle_position,
    l.raw_message_text,
    l.raw_message_text AS raw_message,
    l.category, -- PRESERVES NULL as NULL
    l.intent,
    l.listing_type, -- PRESERVES NULL as NULL
    l.is_bundle,
    l.brand_original,
    l.brand_normalized,
    l.model_original,
    l.model_normalized,
    l.reference_original,
    l.reference_normalized,
    l.dial_color_original,
    l.dial_color_normalized,
    l.dial_color_source,
    l.price_original,
    l.currency_original,
    l.price_normalized,
    l.currency_normalized,
    l.price_usd,
    l.conversion_rate,
    l.reserve_price,
    l.price_min,
    l.price_max,
    l.price_avg,
    l.condition_original,
    l.condition_normalized,
    l.box_original,
    l.box_normalized,
    l.papers_original,
    l.papers_normalized,
    l.image_url,
    l.report_url,
    COALESCE(l.user_name, l.from_name) AS seller_name,
    COALESCE(l.contact_number, l.from_number) AS seller_phone,
    l.from_name,
    l.from_number,
    l.phone_code,
    l.location,
    l.rating,
    l.dealer_rating,
    l.review_count,
    l.wts_post_count,
    l.wtb_post_count,
    l.group_count,
    l.is_verified_user,
    l.is_paid_user,
    l.is_seller_approved,
    l.company_id,
    l.contact_consent,
    l.catalog_confirmed,
    l.overall_confidence,
    l.provenance_metadata,
    l.verdict,
    l.normalization_status,
    l.trading_floor_status, -- PRESERVES NULL as NULL
    l.trading_floor_status AS listing_status,
    l.price_research_status,
    l.transport_checksum,
    l.seller_item_signature,
    l.listing_event_signature,
    l.batch_id,
    l.created_at,
    l.created_at AS posting_date,
    l.created_at AS imported_at,
    l.front_image,
    COALESCE(l.image_urls, CASE WHEN l.image_url IS NOT NULL THEN jsonb_build_array(l.image_url) ELSE '[]'::jsonb END) AS image_urls,
    l.has_exact_source_image,
    l.image_provenance,
    COALESCE(l.source_image_preserved, l.front_image IS NOT NULL OR l.image_url IS NOT NULL) AS source_image_preserved,
    COALESCE(l.image_url_resolvable, l.image_url IS NOT NULL) AS image_url_resolvable,
    COALESCE(l.visually_verified, false) AS visually_verified,
    l.storage_key,
    l.attachment_keys,
    l.mime_type,
    l.media_fingerprint,
    COALESCE(l.first_posted_at, l.created_at) AS first_posted_at,
    l.reposted_at,
    CASE 
        WHEN l.price_usd > 0 AND l.price_usd IS NOT NULL AND l.currency_normalized IS NOT NULL AND l.verdict = 'APPROVED' 
        THEN l.price_usd 
        ELSE NULL 
    END AS verified_price_usd,
    CASE WHEN l.price_usd > 0 THEN l.price_usd ELSE NULL END AS workbook_price_usd,
    true AS contact_publication_approved,
    NULL::text AS source_file,
    NULL::bigint AS source_row_number,
    NULL::text AS source_record_id,
    l.brand_normalized AS brand_scope,
    l.brand_original AS supplied_brand,
    l.brand_normalized AS canonical_brand,
    l.model_normalized AS model,
    NULL::text AS catalog_model,
    l.reference_original AS raw_reference,
    l.reference_normalized AS normalized_reference,
    NULL::text AS catalog_reference,
    l.reference_normalized AS public_reference,
    l.dial_color_normalized AS dial_color,
    NULL::text AS catalog_dial,
    l.condition_normalized AS condition,
    l.price_original AS source_price_amount,
    l.currency_normalized AS source_currency,
    l.price_research_status AS price_evidence_status,
    l.overall_confidence AS confidence,
    'VERIFIED'::text AS verification_status,
    l.image_url AS user_image_url,
    (l.price_usd > 0 AND l.currency_normalized IS NOT NULL) AS has_verified_usd_price,
    LOWER(REGEXP_REPLACE(l.reference_normalized, '[^a-zA-Z0-9]', '', 'g')) AS reference_search_key,
    (l.brand_normalized IS NOT NULL AND l.reference_normalized IS NOT NULL) AS has_complete_identity
FROM staging.listings l
WHERE l.trading_floor_status != 'suppressed_exact_duplicate' 
   OR l.trading_floor_status IS NULL;

-- 3. Recreate Deferred Bundle View
DROP VIEW IF EXISTS public.deferred_bundle_listings_v1 CASCADE;

CREATE VIEW public.deferred_bundle_listings_v1 AS
SELECT 
    l.id AS listing_id,
    l.job_id,
    l.raw_message_text,
    l.category,
    l.listing_type,
    l.is_bundle,
    l.price_usd,
    l.currency_normalized,
    COALESCE(l.user_name, l.from_name) AS seller_name,
    COALESCE(l.contact_number, l.from_number) AS seller_phone,
    l.location,
    l.trading_floor_status,
    l.price_research_status,
    l.batch_id,
    l.created_at,
    l.front_image,
    l.image_url AS final_image_url,
    l.storage_key,
    l.attachment_keys
FROM staging.listings l
WHERE l.is_bundle = true 
   OR l.trading_floor_status = 'bundle_pending_separation'
   OR l.price_research_status = 'ineligible_bundle';

-- 4. Recreate Strict Price Research View
DROP VIEW IF EXISTS public.price_research_verified_source CASCADE;

CREATE VIEW public.price_research_verified_source AS
WITH ranked_seller_offers AS (
    SELECT 
        l.*,
        ROW_NUMBER() OVER (
            PARTITION BY l.seller_item_signature 
            ORDER BY l.created_at DESC
        ) AS repost_rank
    FROM staging.listings l
    WHERE l.category = 'WATCH'
      AND (l.listing_type = 'WTS' OR l.intent = 'sale')
      AND (l.is_bundle = false OR l.is_bundle IS NULL)
      AND l.trading_floor_status NOT IN ('bundle_pending_separation', 'suppressed_exact_duplicate', 'suppressed_repost', 'archived', 'rejected')
      AND l.price_research_status IN ('eligible', 'VERIFIED')
      AND l.price_usd > 0
      AND l.currency_normalized IS NOT NULL
      AND l.brand_normalized IS NOT NULL
      AND l.reference_normalized IS NOT NULL
)
SELECT 
    r.id,
    r.job_id,
    r.raw_message_text,
    r.raw_message_text AS raw_message,
    r.category,
    'WTS'::text AS listing_type,
    r.brand_normalized AS brand,
    r.brand_original,
    r.brand_normalized,
    r.model_normalized AS model,
    r.model_original,
    r.model_normalized,
    r.reference_normalized AS reference,
    r.reference_original,
    r.reference_normalized,
    r.dial_color_normalized AS dial_color,
    r.dial_color_original,
    r.dial_color_normalized,
    r.condition_normalized AS condition,
    r.condition_original,
    r.condition_normalized,
    r.currency_normalized AS currency,
    r.currency_original,
    r.currency_normalized,
    r.price_original AS price_raw,
    r.price_original,
    r.price_usd,
    r.box_original,
    r.box_normalized,
    r.papers_original,
    r.papers_normalized,
    r.image_url,
    r.image_url AS thumbnail_url,
    r.image_url AS display_image_url,
    (r.image_url IS NOT NULL OR r.front_image IS NOT NULL) AS has_images,
    COALESCE(r.user_name, r.from_name) AS seller_name,
    COALESCE(r.contact_number, r.from_number) AS seller_phone,
    COALESCE(r.contact_number, r.from_number) AS phone_number,
    COALESCE(r.user_name, r.from_name) AS posted_by,
    r.location,
    r.rating,
    r.dealer_rating,
    r.trading_floor_status,
    r.trading_floor_status AS listing_status,
    r.price_research_status,
    r.transport_checksum,
    r.seller_item_signature,
    r.listing_event_signature,
    r.batch_id,
    r.created_at,
    r.created_at AS listing_date,
    r.front_image,
    r.image_urls,
    r.has_exact_source_image,
    r.storage_key,
    r.attachment_keys,
    r.mime_type,
    r.media_fingerprint,
    COALESCE(r.first_posted_at, r.created_at) AS first_posted_at,
    r.reposted_at,
    r.verdict,
    r.overall_confidence AS confidence,
    '[]'::jsonb AS flags,
    r.company_id AS dealer_id,
    'thecollective'::text AS source,
    NULL::text AS year,
    NULL::text AS scope_of_delivery
FROM ranked_seller_offers r
WHERE r.repost_rank = 1;

-- Grant permissions to public views
GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, service_role;
GRANT SELECT ON public.deferred_bundle_listings_v1 TO anon, authenticated, service_role;
GRANT SELECT ON public.price_research_verified_source TO anon, authenticated, service_role;
