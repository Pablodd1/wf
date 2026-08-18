-- Forward-only Trading Floor source-price evidence correction.
--
-- An explicitly supplied bare-dollar amount is useful to a buyer, but `$` is
-- not sufficient evidence that the currency is USD. The normalized staging
-- pipeline retains the amount with currency_evidence =
-- `bare_dollar_unconfirmed`, currency NULL, and price_usd NULL. This view makes
-- that distinction visible without changing the Price Research contract.

BEGIN;

CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2 AS
SELECT
    l.id::text                                    AS id,
    l.job_id::text                                AS job_id,
    l.parent_id::text                             AS parent_id,
    COALESCE(
      p.source_group_name,
      CASE WHEN l.normalization_run_key IS NOT NULL THEN 'MARIADB_IMMUTABLE_RAW' ELSE 'AUCTION' END
    )                                             AS source_file,
    1                                             AS source_row_number,
    COALESCE(l.source_record_id, l.id::text)       AS source_record_id,
    l.created_at                                  AS posting_date,
    COALESCE(l.user_name, l.from_name, 'Unknown')  AS posted_by,
    CASE
      WHEN COALESCE(l.contact_consent, FALSE)
        THEN COALESCE(l.contact_number, l.from_number, '')
      ELSE ''
    END                                           AS phone_number,
    COALESCE(l.contact_consent, FALSE)             AS contact_publication_approved,
    l.raw_message_text                            AS raw_message,
    l.intent                                      AS intent,
    l.listing_type                                AS listing_type,
    COALESCE(l.brand_normalized, l.brand_original, 'OTHER') AS brand_scope,
    l.brand_original                              AS supplied_brand,
    l.brand_normalized                            AS canonical_brand,
    l.model_original                              AS model,
    l.model_normalized                            AS catalog_model,
    l.reference_original                          AS raw_reference,
    l.reference_normalized                        AS normalized_reference,
    l.reference_normalized                        AS catalog_reference,
    l.dial_color_normalized                       AS dial_color,
    l.dial_color_normalized                       AS catalog_dial,
    l.condition_normalized                        AS condition,
    l.price_usd                                   AS workbook_price_usd,
    l.price_normalized                            AS source_price_amount,
    CASE
      WHEN l.price_normalized > 0
        AND l.currency_evidence = 'bare_dollar_unconfirmed'
        THEN '$' || l.price_normalized::text
      WHEN l.price_normalized > 0
        THEN l.price_normalized::text || ' ' || COALESCE(l.currency_normalized, '')
      ELSE 'Price not supplied'
    END                                           AS source_price_text,
    l.currency_normalized                         AS source_currency,
    CASE
      WHEN l.currency_normalized IN ('USD', 'USDT') AND l.price_usd > 0
        THEN 'SOURCE_EXPLICIT_USD_MATCH'
      WHEN l.price_usd > 0
        THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
      WHEN l.price_normalized > 0 AND l.currency_normalized IS NULL
        THEN 'CURRENCY_UNCONFIRMED'
      ELSE 'PRICE_NOT_SUPPLIED'
    END                                           AS price_evidence_status,
    l.overall_confidence                          AS confidence,
    l.verdict                                     AS verification_status,
    CASE
      WHEN l.parent_id IS NULL
        AND COALESCE(l.is_bundle, FALSE) = FALSE
        AND COALESCE(l.listing_type, '') NOT IN ('MULTI', 'MULTI_LISTING', 'BUNDLE')
        AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(l.image_url)
      ELSE NULL
    END                                           AS user_image_url,
    l.created_at                                  AS imported_at,
    (
      l.parent_id IS NULL
      AND COALESCE(l.is_bundle, FALSE) = FALSE
      AND COALESCE(l.listing_type, '') NOT IN ('MULTI', 'MULTI_LISTING', 'BUNDLE')
      AND btrim(COALESCE(l.image_url, '')) ~* '^https?://[^[:space:]]+$'
    )                                             AS has_exact_source_image,
    CASE
      WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED'
        AND l.currency_normalized IN ('USD', 'USDT')
        AND l.price_usd > 0
      THEN l.price_usd
      ELSE NULL
    END                                           AS verified_price_usd,
    (
      upper(COALESCE(l.verdict, '')) = 'APPROVED'
      AND l.currency_normalized IN ('USD', 'USDT')
      AND l.price_usd > 0
    )                                             AS has_verified_usd_price,
    (l.brand_normalized IS NOT NULL AND l.reference_normalized IS NOT NULL)
                                                    AS has_complete_identity,
    (l.price_normalized > 0)                      AS has_supplied_price,
    l.verdict                                     AS verdict,
    l.verdict                                     AS listing_status,
    l.normalization_status                        AS normalization_status,
    l.trading_floor_status                        AS trading_floor_status,
    l.price_research_status                       AS price_research_status,
    COALESCE(l.user_name, l.from_name)             AS seller_name,
    CASE
      WHEN COALESCE(l.contact_consent, FALSE)
        THEN COALESCE(l.contact_number, l.from_number)
      ELSE NULL
    END                                           AS seller_phone,
    NULLIF(btrim(l.location), '')                  AS location,
    NULLIF(
      regexp_replace(
        upper(COALESCE(l.reference_normalized, l.reference_original, '')),
        '[^A-Z0-9]',
        '',
        'g'
      ),
      ''
    )                                             AS reference_search_key,
    CASE
      WHEN upper(COALESCE(l.category, '')) IN ('WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY')
        THEN upper(l.category)
      ELSE 'OTHER'
    END                                           AS item_category,
    CASE
      WHEN upper(COALESCE(l.verdict, '')) = 'APPROVED' THEN 'APPROVED'
      ELSE 'PENDING_VERIFICATION'
    END                                           AS publication_state,
    CASE
      WHEN l.normalization_run_key IS NOT NULL THEN 'QNSA_NORMALIZED_STAGING_V1'
      ELSE 'REVIEWED_LEGACY'
    END                                           AS publication_lane,
    (c.status = 'NORMALIZATION_STAGED' AND c.error_rows = 0)
                                                    AS normalization_run_complete,
    (
      l.raw_message_version_id IS NOT NULL
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    )                                             AS raw_lineage_verified
FROM staging.listings AS l
LEFT JOIN jobs.processing_jobs AS j ON l.job_id = j.id
LEFT JOIN raw.payloads AS p ON j.raw_payload_id = p.id
LEFT JOIN staging.mariadb_normalization_import_checkpoints AS c
  ON c.run_key = l.normalization_run_key
WHERE l.parent_id IS NULL
  AND COALESCE(l.is_bundle, FALSE) = FALSE
  AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
  AND upper(COALESCE(l.category, '')) IN ('WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY')
  AND l.trading_floor_status IN ('published', 'published_pending_verification')
  AND upper(COALESCE(l.verdict, '')) NOT IN ('REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
  AND (
    (
      upper(COALESCE(l.verdict, '')) = 'APPROVED'
      AND CASE
        WHEN l.overall_confidence BETWEEN 0 AND 1 THEN l.overall_confidence * 100
        ELSE l.overall_confidence
      END >= 90
    )
    OR (
      l.trading_floor_status = 'published_pending_verification'
      AND l.normalization_run_key IS NOT NULL
      AND l.publication_review_status = 'PENDING_REVIEW'
      AND l.raw_message_version_id IS NOT NULL
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND c.status = 'NORMALIZATION_STAGED'
      AND c.error_rows = 0
    )
  );

GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO anon, authenticated, service_role;

COMMENT ON VIEW public.reviewed_workbook_market_source_v2 IS
  'Trading Floor singles with source-price evidence preserved. Bare-dollar amounts remain currency-unconfirmed and excluded from Price Research.';

COMMIT;
