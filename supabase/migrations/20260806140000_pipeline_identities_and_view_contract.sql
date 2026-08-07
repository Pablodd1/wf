-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: Identity Signatures & View Contracts
-- Migration ID: 20260806140000_pipeline_identities_and_view_contract.sql
-- Description:
-- 1. Add transport_checksum, seller_item_signature, listing_event_signature to staging.listings
-- 2. Add reputation & UI activity fields (review_count, group_count, wts_post_count, wtb_post_count, public_reference, reference_search_key)
-- 3. Recreate public views (reviewed_workbook_market_source_v2 & price_research_verified_source) with full UI contracts
-- ============================================================================

-- 1. ADD IDENTITY & METRIC COLUMNS TO STAGING.LISTINGS
ALTER TABLE staging.listings
ADD COLUMN IF NOT EXISTS transport_checksum TEXT,
ADD COLUMN IF NOT EXISTS seller_item_signature TEXT,
ADD COLUMN IF NOT EXISTS listing_event_signature TEXT,
ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS group_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS wts_post_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS wtb_post_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS public_reference TEXT,
ADD COLUMN IF NOT EXISTS reference_search_key TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_transport_checksum ON staging.listings(transport_checksum);
CREATE INDEX IF NOT EXISTS idx_listings_seller_item_sig ON staging.listings(seller_item_signature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_event_sig ON staging.listings(listing_event_signature);

-- 2. DROP EXISTING VIEWS
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2 CASCADE;
DROP VIEW IF EXISTS public.price_research_verified_source CASCADE;

-- 3. CREATE REVIEWED WORKBOOK MARKET SOURCE V2 VIEW (TRADING FLOOR)
CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT 
    l.id::text                                  AS id,
    l.job_id::text                              AS job_id,
    l.parent_id::text                           AS parent_id,
    l.transport_checksum                        AS transport_checksum,
    l.seller_item_signature                     AS seller_item_signature,
    l.listing_event_signature                    AS listing_event_signature,
    COALESCE(p.source_group_name, 'AUCTION')     AS source_file,
    1                                           AS source_row_number,
    l.id::text                                  AS source_record_id,
    l.created_at                                AS posting_date,
    COALESCE(l.user_name, l.from_name, 'Unknown') AS posted_by,
    COALESCE(l.contact_number, l.from_number, '') AS phone_number,
    TRUE                                        AS contact_publication_approved,
    l.raw_message_text                          AS raw_message,
    l.intent                                    AS intent,
    l.listing_type                              AS listing_type,
    COALESCE(l.brand_normalized, l.brand_original, 'OTHER') AS brand_scope,
    l.brand_original                            AS supplied_brand,
    l.brand_normalized                          AS canonical_brand,
    l.model_original                            AS model,
    l.model_normalized                          AS catalog_model,
    l.reference_original                        AS raw_reference,
    l.reference_normalized                      AS normalized_reference,
    l.reference_normalized                      AS catalog_reference,
    COALESCE(l.public_reference, l.reference_normalized) AS public_reference,
    COALESCE(l.reference_search_key, LOWER(l.reference_normalized)) AS reference_search_key,
    l.dial_color_normalized                     AS dial_color,
    l.dial_color_normalized                     AS catalog_dial,
    l.condition_normalized                      AS condition,
    l.price_usd                                 AS workbook_price_usd,
    l.price_normalized                          AS source_price_amount,
    CASE 
        WHEN l.price_normalized > 0 THEN l.price_normalized::text || ' ' || l.currency_normalized
        ELSE 'Price not supplied' 
    END                                         AS source_price_text,
    l.currency_normalized                       AS source_currency,
    CASE 
        WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0 THEN 'SOURCE_EXPLICIT_USD_MATCH'
        WHEN l.price_usd > 0 THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
        ELSE 'PRICE_NOT_SUPPLIED' 
    END                                         AS price_evidence_status,
    l.overall_confidence                        AS confidence,
    l.verdict                                   AS verification_status,
    CASE 
        WHEN l.parent_id IS NULL AND l.is_bundle = TRUE THEN '' 
        ELSE COALESCE(l.image_url, '') 
    END                                         AS user_image_url,
    l.created_at                                AS imported_at,
    (l.image_url IS NOT NULL AND l.image_url != '') AS has_exact_source_image,
    l.price_usd                                 AS verified_price_usd,
    (l.price_usd > 0)                           AS has_verified_usd_price,
    (l.brand_normalized IS NOT NULL AND l.reference_normalized IS NOT NULL) AS has_complete_identity,
    (l.price_normalized > 0)                    AS has_supplied_price,
    COALESCE(l.rating, l.dealer_rating, 0.0)    AS rating,
    COALESCE(l.review_count, 0)                 AS review_count,
    COALESCE(l.group_count, 1)                  AS group_count,
    COALESCE(l.wts_post_count, 0)               AS wts_post_count,
    COALESCE(l.wtb_post_count, 0)               AS wtb_post_count,
    COALESCE(l.first_posted_at, l.created_at)   AS first_post_date,
    COALESCE(l.reposted_at, l.created_at)       AS latest_post_date,
    COALESCE(l.location, 'Global')              AS location,
    COALESCE(p.source_group_name, 'AUCTION')    AS region,
    l.verdict                                   AS verdict,
    l.verdict                                   AS listing_status,
    l.normalization_status                      AS normalization_status,
    l.trading_floor_status                      AS trading_floor_status,
    l.price_research_status                     AS price_research_status
FROM staging.listings l
LEFT JOIN jobs.processing_jobs j ON l.job_id = j.id
LEFT JOIN raw.payloads p ON j.raw_payload_id = p.id
WHERE l.trading_floor_status IN ('published', 'bundle_pending_separation', 'published_pending_verification');

-- 4. CREATE PRICE RESEARCH VERIFIED SOURCE VIEW
CREATE OR REPLACE VIEW public.price_research_verified_source AS
SELECT 
    l.id::text                                  AS id,
    l.job_id::text                              AS job_id,
    l.transport_checksum                        AS transport_checksum,
    l.seller_item_signature                     AS seller_item_signature,
    l.listing_event_signature                    AS listing_event_signature,
    l.intent                                    AS intent,
    l.brand_normalized                          AS brand,
    l.model_normalized                          AS model,
    l.reference_normalized                      AS reference,
    l.reference_normalized                      AS normalized_reference,
    COALESCE(l.public_reference, l.reference_normalized) AS public_reference,
    COALESCE(l.reference_search_key, LOWER(l.reference_normalized)) AS reference_search_key,
    l.dial_color_normalized                     AS dial_color,
    l.condition_normalized                      AS condition,
    l.price_normalized                          AS price,
    l.price_usd                                 AS price_usd,
    l.price_normalized                          AS price_raw,
    l.currency_normalized                       AS currency,
    l.box_normalized                            AS box,
    l.papers_normalized                         AS papers,
    l.raw_message_text                          AS raw_message,
    COALESCE(l.user_name, l.from_name, 'Unknown') AS posted_by,
    COALESCE(l.user_name, l.from_name, 'Unknown') AS seller_name,
    COALESCE(l.contact_number, l.from_number, '') AS phone_number,
    COALESCE(l.contact_number, l.from_number, '') AS seller_phone,
    '[]'::jsonb                                 AS flags,
    l.created_at                                AS listing_date,
    l.created_at                                AS created_at,
    COALESCE(p.source_group_name, 'AUCTION')    AS source,
    NULL::text                                  AS year,
    l.company_id::text                          AS dealer_id,
    l.overall_confidence                        AS confidence,
    l.overall_confidence                        AS overall_confidence,
    COALESCE(l.image_url, '')                   AS thumbnail_url,
    COALESCE(l.image_url, '')                   AS image_url,
    COALESCE(l.image_url, '')                   AS display_image_url,
    CASE 
        WHEN l.image_url IS NOT NULL AND l.image_url != '' THEN jsonb_build_array(l.image_url)
        ELSE '[]'::jsonb 
    END                                         AS image_urls,
    (l.image_url IS NOT NULL AND l.image_url != '') AS has_images,
    l.listing_type                              AS listing_type,
    (l.brand_normalized IS NOT NULL AND l.reference_normalized IS NOT NULL) AS has_complete_identity,
    COALESCE(l.rating, l.dealer_rating, 0.0)    AS rating,
    COALESCE(l.review_count, 0)                 AS review_count,
    COALESCE(l.group_count, 1)                  AS group_count,
    COALESCE(l.wts_post_count, 0)               AS wts_post_count,
    COALESCE(l.wtb_post_count, 0)               AS wtb_post_count,
    COALESCE(l.first_posted_at, l.created_at)   AS first_post_date,
    COALESCE(l.reposted_at, l.created_at)       AS latest_post_date,
    COALESCE(l.location, 'Global')              AS location,
    COALESCE(p.source_group_name, 'AUCTION')    AS region,
    l.verdict                                   AS verdict,
    'APPROVED'::text                            AS listing_status,
    l.normalization_status                      AS normalization_status,
    l.trading_floor_status                      AS trading_floor_status,
    l.price_research_status                     AS price_research_status
FROM staging.listings l
LEFT JOIN jobs.processing_jobs j ON l.job_id = j.id
LEFT JOIN raw.payloads p ON j.raw_payload_id = p.id
WHERE l.price_research_status = 'eligible';

-- 5. GRANT PERMISSIONS
GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, service_role;
GRANT SELECT ON public.price_research_verified_source TO anon, authenticated, service_role;
