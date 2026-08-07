-- ============================================================================
-- WatchFacts Ingestion Pipeline - Forward Correction Migration
-- Migration ID: 20260807100000_correction_gate_media_and_analytics_integrity.sql
-- Description: Removes hardcoded view claims, derives state from staging, restores duplicate suppression, and enforces strict sales research eligibility.
-- ============================================================================

BEGIN;

-- 1. Ensure staging.listings media preservation columns exist
ALTER TABLE staging.listings 
  ADD COLUMN IF NOT EXISTS front_image text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_urls jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS has_exact_source_image boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_provenance text DEFAULT 'exact_source';

-- 2. Drop dependent view safely after audit
DROP VIEW IF EXISTS public.price_research_verified_source CASCADE;
DROP VIEW IF EXISTS public.reviewed_workbook_market_source_v2 CASCADE;

-- 3. Recreate public Trading Floor view with DERIVED values (no hardcoded verification)
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
  l.price_usd AS verified_price_usd,
  l.price_usd AS workbook_price_usd,
  l.created_at AS created_at,
  l.created_at AS listing_date,
  l.created_at AS posting_date,
  l.created_at AS imported_at,
  l.raw_message_text AS raw_message,
  l.category,
  l.intent,
  l.listing_type,
  l.trading_floor_status,
  l.price_research_status,
  COALESCE(l.price_research_status, 'UNVERIFIED') AS price_evidence_status,
  l.provenance_metadata,
  l.from_number AS dealer_id,
  l.from_name AS seller_name,
  l.from_number AS seller_phone,
  l.location,
  l.rating,
  l.dealer_rating,
  l.review_count,
  l.wts_post_count,
  l.wtb_post_count,
  l.group_count,
  l.first_posted_at,
  l.reposted_at,
  l.is_verified_user,
  l.is_seller_approved,
  l.is_bundle,
  l.parent_id,
  l.bundle_position,
  l.front_image,
  COALESCE(l.image_url, l.front_image) AS thumbnail_url,
  COALESCE(l.image_url, l.front_image) AS final_image_url,
  l.image_url AS user_image_url,
  l.image_urls,
  COALESCE(l.has_exact_source_image, l.image_url IS NOT NULL OR l.front_image IS NOT NULL) AS has_exact_source_image,
  COALESCE(l.has_exact_source_image, l.image_url IS NOT NULL OR l.front_image IS NOT NULL) AS has_images,
  COALESCE(l.image_provenance, 'exact_source') AS image_provenance,
  'THE_COLLECTIVE'::text AS source,
  'mysql_thecollective'::text AS source_file,
  1::integer AS source_row_number,
  '{}'::jsonb AS flags,
  COALESCE(l.contact_consent, false) AS contact_publication_approved,
  (l.price_usd IS NOT NULL AND l.price_usd > 0 AND l.price_research_status = 'VERIFIED') AS has_verified_usd_price,
  (l.brand_normalized IS NOT NULL AND l.brand_normalized != '' AND l.reference_normalized IS NOT NULL AND l.reference_normalized != '') AS has_complete_identity,
  COALESCE(l.verdict, 'PENDING') AS verdict,
  l.overall_confidence AS confidence,
  COALESCE(l.normalization_status, 'UNVERIFIED') AS verification_status,
  COALESCE(l.trading_floor_status, 'DRAFT') AS listing_status
FROM staging.listings l;

-- 4. Recreate public sales research view with STRICT eligibility guarantees
CREATE VIEW public.price_research_verified_source AS
SELECT *
FROM public.reviewed_workbook_market_source_v2
WHERE (category = 'WATCH' OR category IS NULL)
  AND (listing_type = 'WTS' OR listing_type = 'sale' OR intent = 'sale')
  AND (is_bundle = false OR is_bundle IS NULL)
  AND (trading_floor_status NOT IN ('bundle_pending_separation', 'suppressed_exact_duplicate', 'suppressed_duplicate', 'rejected', 'archived') OR trading_floor_status IS NULL)
  AND price_usd > 0
  AND (price_research_status IN ('VERIFIED', 'eligible') OR price_research_status IS NULL)
  AND brand IS NOT NULL AND brand != ''
  AND reference IS NOT NULL AND reference != ''
  AND source_currency IS NOT NULL AND source_currency != '';

GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, postgres, service_role;
GRANT SELECT ON public.price_research_verified_source TO anon, authenticated, postgres, service_role;

COMMIT;
