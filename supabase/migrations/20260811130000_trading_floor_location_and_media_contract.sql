-- Forward-only Trading Floor contract update.
--
-- Adds source-supplied location for server-side filtering and makes every
-- bundle parent/child image fail closed. A media flag without an exact HTTP(S)
-- URL is never sufficient to create an image lane or an empty image frame.

BEGIN;

CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT
    l.id::text                                   AS id,
    l.job_id::text                               AS job_id,
    l.parent_id::text                            AS parent_id,
    COALESCE(p.source_group_name, 'AUCTION')      AS source_file,
    1                                            AS source_row_number,
    l.id::text                                   AS source_record_id,
    l.created_at                                 AS posting_date,
    COALESCE(l.user_name, l.from_name, 'Unknown') AS posted_by,
    COALESCE(l.contact_number, l.from_number, '') AS phone_number,
    TRUE                                         AS contact_publication_approved,
    l.raw_message_text                           AS raw_message,
    l.intent                                     AS intent,
    l.listing_type                               AS listing_type,
    COALESCE(l.brand_normalized, l.brand_original, 'OTHER') AS brand_scope,
    l.brand_original                             AS supplied_brand,
    l.brand_normalized                           AS canonical_brand,
    l.model_original                             AS model,
    l.model_normalized                           AS catalog_model,
    l.reference_original                         AS raw_reference,
    l.reference_normalized                       AS normalized_reference,
    l.reference_normalized                       AS catalog_reference,
    l.dial_color_normalized                      AS dial_color,
    l.dial_color_normalized                      AS catalog_dial,
    l.condition_normalized                       AS condition,
    l.price_usd                                  AS workbook_price_usd,
    l.price_normalized                           AS source_price_amount,
    CASE
      WHEN l.price_normalized > 0
        THEN l.price_normalized::text || ' ' || COALESCE(l.currency_normalized, '')
      ELSE 'Price not supplied'
    END                                          AS source_price_text,
    l.currency_normalized                        AS source_currency,
    CASE
      WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0
        THEN 'SOURCE_EXPLICIT_USD_MATCH'
      WHEN l.price_usd > 0
        THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
      ELSE 'PRICE_NOT_SUPPLIED'
    END                                          AS price_evidence_status,
    l.overall_confidence                         AS confidence,
    l.verdict                                    AS verification_status,
    CASE
      WHEN l.parent_id IS NULL
        AND COALESCE(l.is_bundle, FALSE) = FALSE
        AND COALESCE(l.listing_type, '') NOT IN ('MULTI', 'MULTI_LISTING', 'BUNDLE')
        AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(l.image_url)
      ELSE NULL
    END                                          AS user_image_url,
    l.created_at                                 AS imported_at,
    (
      l.parent_id IS NULL
      AND COALESCE(l.is_bundle, FALSE) = FALSE
      AND COALESCE(l.listing_type, '') NOT IN ('MULTI', 'MULTI_LISTING', 'BUNDLE')
      AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$'
    )                                            AS has_exact_source_image,
    l.price_usd                                  AS verified_price_usd,
    (l.price_usd > 0)                            AS has_verified_usd_price,
    (l.brand_normalized IS NOT NULL AND l.reference_normalized IS NOT NULL)
                                                   AS has_complete_identity,
    (l.price_normalized > 0)                     AS has_supplied_price,
    l.verdict                                    AS verdict,
    l.verdict                                    AS listing_status,
    l.normalization_status                       AS normalization_status,
    l.trading_floor_status                       AS trading_floor_status,
    l.price_research_status                      AS price_research_status,
    COALESCE(l.user_name, l.from_name)            AS seller_name,
    COALESCE(l.contact_number, l.from_number)     AS seller_phone,
    NULLIF(btrim(l.location), '')                 AS location,
    NULLIF(
      regexp_replace(
        upper(COALESCE(l.reference_normalized, l.reference_original, '')),
        '[^A-Z0-9]',
        '',
        'g'
      ),
      ''
    )                                            AS reference_search_key
FROM staging.listings AS l
LEFT JOIN jobs.processing_jobs AS j ON l.job_id = j.id
LEFT JOIN raw.payloads AS p ON j.raw_payload_id = p.id
WHERE l.trading_floor_status IN ('published', 'published_pending_verification')
  AND COALESCE(l.trading_floor_status, '') NOT IN (
    'bundle_child_pending_review',
    'bundle_pending_separation',
    'suppressed_exact_duplicate'
  )
  AND upper(COALESCE(l.verdict, '')) NOT IN ('REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED');

GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, service_role;

COMMIT;
