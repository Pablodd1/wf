-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: Clean View Contracts & Intent Data Fix
-- Migration ID: 20260806150000_single_to_intent_and_view_contract_updates.sql
-- Description:
-- 1. Migrate legacy 'SINGLE' listing_type records to true intent ('WTS', 'WTB', 'TRADE')
-- 2. Add seller_name and seller_phone to reviewed_workbook_market_source_v2
-- 3. Remove invented defaults (hardcoded ratings, artificial location, fake post counts) -> return NULL when not supplied
-- ============================================================================

-- 1. MIGRATE LEGACY LISTING_TYPE IN STAGING LISTINGS
UPDATE staging.listings 
SET listing_type = intent 
WHERE listing_type = 'SINGLE' OR listing_type IS NULL;

-- 2. DROP EXISTING VIEWS
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2 CASCADE;
DROP VIEW IF EXISTS public.price_research_verified_source CASCADE;

-- 3. RECREATE REVIEWED WORKBOOK MARKET SOURCE V2 VIEW (TRADING FLOOR)
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
    COALESCE(l.user_name, l.from_name)          AS posted_by,
    COALESCE(l.user_name, l.from_name)          AS seller_name,
    COALESCE(l.contact_number, l.from_number)   AS phone_number,
    COALESCE(l.contact_number, l.from_number)   AS seller_phone,
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
    COALESCE(l.rating, l.dealer_rating)         AS rating,
    l.review_count                              AS review_count,
    l.group_count                               AS group_count,
    l.wts_post_count                            AS wts_post_count,
    l.wtb_post_count                            AS wtb_post_count,
    l.first_posted_at                           AS first_post_date,
    l.reposted_at                               AS latest_post_date,
    l.location                                  AS location,
    p.source_group_name                         AS region,
    l.verdict                                   AS verdict,
    l.verdict                                   AS listing_status,
    l.normalization_status                      AS normalization_status,
    l.trading_floor_status                      AS trading_floor_status,
    l.price_research_status                     AS price_research_status
FROM staging.listings l
LEFT JOIN jobs.processing_jobs j ON l.job_id = j.id
LEFT JOIN raw.payloads p ON j.raw_payload_id = p.id
WHERE l.trading_floor_status IN ('published', 'bundle_pending_separation', 'published_pending_verification');

-- 4. RECREATE PRICE RESEARCH VERIFIED SOURCE VIEW
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
    COALESCE(l.user_name, l.from_name)          AS posted_by,
    COALESCE(l.user_name, l.from_name)          AS seller_name,
    COALESCE(l.contact_number, l.from_number)   AS phone_number,
    COALESCE(l.contact_number, l.from_number)   AS seller_phone,
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
    COALESCE(l.rating, l.dealer_rating)         AS rating,
    l.review_count                              AS review_count,
    l.group_count                               AS group_count,
    l.wts_post_count                            AS wts_post_count,
    l.wtb_post_count                            AS wtb_post_count,
    l.first_posted_at                           AS first_post_date,
    l.reposted_at                               AS latest_post_date,
    l.location                                  AS location,
    p.source_group_name                         AS region,
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
