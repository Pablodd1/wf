-- Add an evidence-aware market projection and matching read indexes.
-- A supplied but unverified workbook amount is enough to place a listing
-- before true no-price requests, but it is never ranked numerically as USD.
-- No source value, publication decision, or customer record is changed.

CREATE OR REPLACE VIEW public.reviewed_workbook_market_source_v2
WITH (security_invoker = true)
AS
SELECT
  source.*,
  COALESCE(
    source.workbook_price_usd > 0
      OR source.source_price_amount > 0,
    false
  ) AS has_supplied_price
FROM public.reviewed_workbook_market_source AS source;

REVOKE ALL ON public.reviewed_workbook_market_source_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reviewed_workbook_market_source_v2 TO service_role;

COMMENT ON VIEW public.reviewed_workbook_market_source_v2 IS
  'Service-only customer projection ordered by price evidence presence, never by ambiguous workbook values.';

-- PostgreSQL forbids concurrent index creation inside a transaction.
SET lock_timeout = '2min';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_price_evidence_order
  ON public.reviewed_workbook_inventory (
    (
      COALESCE(workbook_price_usd > 0, false)
        OR COALESCE(source_price_amount > 0, false)
    ) DESC,
    (
      COALESCE(
        price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
          AND workbook_price_usd > 0,
        false
      )
    ) DESC,
    (
      CASE
        WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
          AND workbook_price_usd > 0
        THEN workbook_price_usd
        ELSE NULL
      END
    ) DESC NULLS LAST,
    (
      COALESCE(
        NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$',
        false
      )
    ) DESC,
    posting_date DESC NULLS LAST,
    id
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_type_price_evidence_order
  ON public.reviewed_workbook_inventory (
    listing_type,
    (
      COALESCE(workbook_price_usd > 0, false)
        OR COALESCE(source_price_amount > 0, false)
    ) DESC,
    (
      COALESCE(
        price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
          AND workbook_price_usd > 0,
        false
      )
    ) DESC,
    (
      CASE
        WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
          AND workbook_price_usd > 0
        THEN workbook_price_usd
        ELSE NULL
      END
    ) DESC NULLS LAST,
    (
      COALESCE(
        NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$',
        false
      )
    ) DESC,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

-- The numeric workbook-order indexes temporarily supported the preceding
-- release. Remove them only after both evidence-aware replacements exist.
DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_inventory_price_first;
DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_inventory_type_price_first;
DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_inventory_brand_price_first;
DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_inventory_brand_type_price_first;

NOTIFY pgrst, 'reload schema';
