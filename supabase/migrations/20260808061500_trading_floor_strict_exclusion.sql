-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Migration: View Schema Updates
-- Migration ID: 20260808061500_trading_floor_strict_exclusion.sql
-- ============================================================================

CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT id,
    job_id,
    parent_id,
    bundle_position,
    raw_message_text,
    raw_message_text AS raw_message,
    category,
    intent,
    listing_type,
    is_bundle,
    brand_original,
    brand_normalized,
    model_original,
    model_normalized,
    reference_original,
    reference_normalized,
    dial_color_original,
    dial_color_normalized,
    dial_color_source,
    price_original,
    currency_original,
    price_normalized,
    currency_normalized,
    price_usd,
    conversion_rate,
    reserve_price,
    price_min,
    price_max,
    price_avg,
    condition_original,
    condition_normalized,
    box_original,
    box_normalized,
    papers_original,
    papers_normalized,
    CASE WHEN parent_id IS NOT NULL THEN NULL ELSE image_url END AS image_url,
    report_url,
    COALESCE(user_name, from_name) AS seller_name,
    COALESCE(contact_number, from_number) AS seller_phone,
    from_name,
    from_number,
    phone_code,
    location,
    rating,
    dealer_rating,
    review_count,
    wts_post_count,
    wtb_post_count,
    group_count,
    is_verified_user,
    is_paid_user,
    is_seller_approved,
    company_id,
    contact_consent,
    catalog_confirmed,
    overall_confidence,
    provenance_metadata,
    verdict,
    normalization_status,
    trading_floor_status,
    trading_floor_status AS listing_status,
    price_research_status,
    transport_checksum,
    seller_item_signature,
    listing_event_signature,
    batch_id,
    created_at,
    created_at AS posting_date,
    created_at AS imported_at,
    front_image,
    CASE 
        WHEN parent_id IS NOT NULL THEN '[]'::jsonb 
        ELSE COALESCE(image_urls, CASE WHEN image_url IS NOT NULL THEN jsonb_build_array(image_url) ELSE '[]'::jsonb END) 
    END AS image_urls,
    CASE WHEN parent_id IS NOT NULL THEN false ELSE has_exact_source_image END AS has_exact_source_image,
    image_provenance,
    COALESCE(source_image_preserved, front_image IS NOT NULL OR image_url IS NOT NULL) AS source_image_preserved,
    COALESCE(image_url_resolvable, image_url IS NOT NULL) AS image_url_resolvable,
    COALESCE(visually_verified, false) AS visually_verified,
    storage_key,
    attachment_keys,
    mime_type,
    media_fingerprint,
    COALESCE(first_posted_at, created_at) AS first_posted_at,
    reposted_at,
    CASE
        WHEN price_usd > 0::numeric AND price_usd IS NOT NULL AND currency_normalized IS NOT NULL AND verdict::text = 'APPROVED'::text THEN price_usd
        ELSE NULL::numeric
    END AS verified_price_usd,
    CASE
        WHEN price_usd > 0::numeric THEN price_usd
        ELSE NULL::numeric
    END AS workbook_price_usd,
    true AS contact_publication_approved,
    NULL::text AS source_file,
    NULL::bigint AS source_row_number,
    NULL::text AS source_record_id,
    brand_normalized AS brand_scope,
    brand_original AS supplied_brand,
    brand_normalized AS canonical_brand,
    model_normalized AS model,
    NULL::text AS catalog_model,
    reference_original AS raw_reference,
    reference_normalized AS normalized_reference,
    NULL::text AS catalog_reference,
    reference_normalized AS public_reference,
    dial_color_normalized AS dial_color,
    NULL::text AS catalog_dial,
    condition_normalized AS condition,
    price_original AS source_price_amount,
    currency_normalized AS source_currency,
    price_research_status AS price_evidence_status,
    overall_confidence AS confidence,
    'VERIFIED'::text AS verification_status,
    CASE WHEN parent_id IS NOT NULL THEN NULL ELSE image_url END AS user_image_url,
    price_usd > 0::numeric AND currency_normalized IS NOT NULL AS has_verified_usd_price,
    lower(regexp_replace(reference_normalized::text, '[^a-zA-Z0-9]'::text, ''::text, 'g'::text)) AS reference_search_key,
    brand_normalized IS NOT NULL AND reference_normalized IS NOT NULL AS has_complete_identity,
    
    -- Additional requested image suppression aliases
    CASE WHEN parent_id IS NOT NULL THEN NULL ELSE image_url END AS thumbnail_url,
    CASE WHEN parent_id IS NOT NULL THEN NULL ELSE image_url END AS display_image_url,
    CASE WHEN parent_id IS NOT NULL THEN false ELSE (image_url IS NOT NULL AND image_url != '') END AS has_images

   FROM staging.listings l
  WHERE NOT (l.is_bundle = TRUE AND l.parent_id IS NULL)
    AND COALESCE(l.trading_floor_status, '') NOT IN (
        'bundle_child_pending_review',
        'bundle_pending_separation',
        'suppressed_exact_duplicate'
    )
    AND COALESCE(l.verdict, '') NOT IN (
        'REJECTED',
        'HIDDEN',
        'DELETED',
        'ARCHIVED'
    );

CREATE INDEX IF NOT EXISTS idx_trading_floor_ordering 
ON staging.listings (
    (CASE WHEN parent_id IS NOT NULL THEN false ELSE has_exact_source_image END) DESC NULLS LAST, 
    id DESC
);
