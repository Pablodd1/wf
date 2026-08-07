-- Migration: 20260807120000_complete_clean_single_listing_pipeline.sql
-- Goal: Complete clean single-listing pipeline, media preservation, seller info, view integrity, and strict price research.

BEGIN;

-- 1. Add missing media preservation and provenance columns to staging.listings if not exist
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS attachment_keys JSONB DEFAULT '[]'::jsonb;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS media_fingerprint TEXT;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS source_image_preserved BOOLEAN DEFAULT false;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS image_url_resolvable BOOLEAN DEFAULT false;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS visually_verified BOOLEAN DEFAULT false;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS first_posted_at TIMESTAMPTZ;
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS reposted_at TIMESTAMPTZ;

-- 2. Safely recreate Trading Floor View (public.reviewed_workbook_market_source_v2)
DROP VIEW IF EXISTS public.price_research_verified_source;
DROP VIEW IF EXISTS public.deferred_bundle_listings_v1;
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2;

CREATE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT 
    l.id,
    l.id AS source_record_id,
    l.job_id,
    l.batch_id,
    l.brand_normalized AS brand,
    l.brand_normalized AS brand_scope,
    l.brand_original AS supplied_brand,
    l.brand_normalized AS canonical_brand,
    l.model_normalized AS model,
    l.model_normalized AS catalog_model,
    l.reference_original AS raw_reference,
    l.reference_normalized AS reference,
    l.reference_normalized AS normalized_reference,
    l.reference_normalized AS catalog_reference,
    l.reference_normalized AS public_reference,
    l.reference_normalized AS reference_search_key,
    l.dial_color_normalized AS dial_color,
    l.dial_color_normalized AS catalog_dial,
    l.condition_normalized AS condition,
    NULL::text AS year,
    l.price_original AS price_raw,
    l.price_original AS source_price_amount,
    l.currency_normalized AS currency,
    l.currency_normalized AS source_currency,
    l.price_usd,
    CASE 
        WHEN (l.price_usd IS NOT NULL AND l.price_usd > 0 AND l.price_research_status IN ('eligible', 'VERIFIED') AND l.currency_normalized IS NOT NULL)
        THEN l.price_usd 
        ELSE NULL 
    END AS verified_price_usd,
    l.price_usd AS workbook_price_usd,
    l.created_at,
    l.created_at AS listing_date,
    COALESCE(l.first_posted_at, l.created_at) AS posting_date,
    l.created_at AS imported_at,
    l.raw_message_text AS raw_message,
    COALESCE(l.category, 'WATCH') AS category,
    l.intent,
    CASE 
        WHEN LOWER(l.listing_type) IN ('sale', 'wts') THEN 'WTS'
        WHEN LOWER(l.listing_type) IN ('buy', 'wtb') THEN 'WTB'
        WHEN LOWER(l.listing_type) IN ('bundle', 'multi_listing') THEN 'BUNDLE'
        ELSE UPPER(COALESCE(l.listing_type, 'WTS'))
    END AS listing_type,
    COALESCE(l.trading_floor_status, 'published') AS trading_floor_status,
    l.price_research_status,
    COALESCE(l.price_research_status, 'UNVERIFIED') AS price_evidence_status,
    l.provenance_metadata,
    COALESCE(l.contact_number, l.from_number, l.from_name) AS dealer_id,
    COALESCE(l.from_name, l.user_name) AS seller_name,
    COALESCE(l.from_number, l.contact_number) AS seller_phone,
    l.contact_number AS phone_number,
    COALESCE(l.from_name, l.user_name) AS posted_by,
    l.location,
    l.rating,
    l.dealer_rating,
    l.review_count,
    l.wts_post_count,
    l.wtb_post_count,
    l.group_count,
    l.first_posted_at,
    l.reposted_at,
    COALESCE(l.is_verified_user, false) AS is_verified_user,
    COALESCE(l.is_seller_approved, false) AS is_seller_approved,
    COALESCE(l.is_bundle, false) AS is_bundle,
    l.parent_id,
    l.bundle_position,
    l.front_image,
    COALESCE(l.image_url, l.front_image) AS thumbnail_url,
    COALESCE(l.image_url, l.front_image) AS final_image_url,
    COALESCE(l.image_url, l.front_image) AS display_image_url,
    l.image_url AS user_image_url,
    l.image_urls,
    l.storage_key,
    COALESCE(l.attachment_keys, '[]'::jsonb) AS attachment_keys,
    l.mime_type,
    l.media_fingerprint,
    COALESCE(l.source_image_preserved, (l.front_image IS NOT NULL OR l.image_url IS NOT NULL)) AS source_image_preserved,
    COALESCE(l.image_url_resolvable, l.image_url IS NOT NULL) AS image_url_resolvable,
    COALESCE(l.visually_verified, false) AS visually_verified,
    COALESCE(l.has_exact_source_image, ((l.image_url IS NOT NULL) OR (l.front_image IS NOT NULL))) AS has_exact_source_image,
    COALESCE(l.has_exact_source_image, ((l.image_url IS NOT NULL) OR (l.front_image IS NOT NULL))) AS has_images,
    COALESCE(l.image_provenance, 'exact_source') AS image_provenance,
    'THE_COLLECTIVE'::text AS source,
    'mysql_thecollective'::text AS source_file,
    1 AS source_row_number,
    '{}'::jsonb AS flags,
    COALESCE(l.contact_consent, false) AS contact_publication_approved,
    (l.price_usd IS NOT NULL AND l.price_usd > 0 AND l.price_research_status IN ('eligible', 'VERIFIED') AND l.currency_normalized IS NOT NULL) AS has_verified_usd_price,
    (l.brand_normalized IS NOT NULL AND l.brand_normalized != '' AND l.reference_normalized IS NOT NULL AND l.reference_normalized != '') AS has_complete_identity,
    COALESCE(l.verdict, 'PENDING') AS verdict,
    l.overall_confidence AS confidence,
    COALESCE(l.normalization_status, 'UNVERIFIED') AS verification_status,
    COALESCE(l.trading_floor_status, 'DRAFT') AS listing_status,
    l.seller_item_signature,
    l.listing_event_signature,
    l.transport_checksum
FROM staging.listings l
WHERE l.trading_floor_status != 'suppressed_exact_duplicate' OR l.trading_floor_status IS NULL;

-- 3. Create Deferred Bundle View (public.deferred_bundle_listings_v1)
CREATE VIEW public.deferred_bundle_listings_v1 AS
SELECT *
FROM public.reviewed_workbook_market_source_v2
WHERE is_bundle = true 
   OR trading_floor_status = 'bundle_pending_separation'
   OR price_research_status = 'ineligible_bundle';

-- 4. Create Strict Price Research View (public.price_research_verified_source)
-- Enforces:
-- - category = 'WATCH' (STRICTLY)
-- - listing_type = 'WTS' (STRICTLY)
-- - is_bundle = false (STRICTLY)
-- - price_usd > 0 (STRICTLY)
-- - price_research_status IN ('eligible', 'VERIFIED') (STRICTLY)
-- - valid brand, reference, and currency evidence
-- - trading_floor_status NOT IN ('bundle_pending_separation', 'suppressed_exact_duplicate', 'suppressed_repost', 'rejected', 'archived')
-- - Repost Deduplication: counts ONLY the latest active offer per seller_item_signature!
CREATE VIEW public.price_research_verified_source AS
WITH ranked_offers AS (
    SELECT 
        v.*,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(v.seller_item_signature, v.id::text) 
            ORDER BY v.created_at DESC
        ) AS repost_rank
    FROM public.reviewed_workbook_market_source_v2 v
    WHERE v.category = 'WATCH'
      AND v.listing_type = 'WTS'
      AND (v.is_bundle = false OR v.is_bundle IS NULL)
      AND v.trading_floor_status NOT IN ('bundle_pending_separation', 'suppressed_exact_duplicate', 'suppressed_repost', 'rejected', 'archived', 'pending')
      AND v.price_usd > 0
      AND v.price_research_status IN ('eligible', 'VERIFIED')
      AND v.brand IS NOT NULL AND v.brand != ''
      AND v.reference IS NOT NULL AND v.reference != ''
      AND v.source_currency IS NOT NULL AND v.source_currency != ''
)
SELECT 
    id, source_record_id, job_id, batch_id, brand, brand_scope, supplied_brand, canonical_brand,
    model, catalog_model, raw_reference, reference, normalized_reference, catalog_reference,
    public_reference, reference_search_key, dial_color, catalog_dial, condition, year,
    price_raw, source_price_amount, currency, source_currency, price_usd, verified_price_usd,
    workbook_price_usd, created_at, listing_date, posting_date, imported_at, raw_message,
    category, intent, listing_type, trading_floor_status, price_research_status,
    price_evidence_status, provenance_metadata, dealer_id, seller_name, seller_phone,
    phone_number, posted_by, location, rating, dealer_rating, review_count, wts_post_count,
    wtb_post_count, group_count, first_posted_at, reposted_at, is_verified_user,
    is_seller_approved, is_bundle, parent_id, bundle_position, front_image, thumbnail_url,
    final_image_url, display_image_url, user_image_url, image_urls, storage_key, attachment_keys,
    mime_type, media_fingerprint, source_image_preserved, image_url_resolvable, visually_verified,
    has_exact_source_image, has_images, image_provenance, source, source_file, source_row_number,
    flags, contact_publication_approved, has_verified_usd_price, has_complete_identity, verdict,
    confidence, verification_status, listing_status, seller_item_signature, listing_event_signature,
    transport_checksum
FROM ranked_offers
WHERE repost_rank = 1;

-- 5. Grant Permissions to Views
GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, service_role;
GRANT SELECT ON public.deferred_bundle_listings_v1 TO anon, authenticated, service_role;
GRANT SELECT ON public.price_research_verified_source TO anon, authenticated, service_role;

COMMIT;
