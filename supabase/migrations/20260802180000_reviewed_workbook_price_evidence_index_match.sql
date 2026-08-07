-- PostgreSQL expression indexes must match the inlined service-view expression
-- exactly. Build the exact-match replacements before dropping the equivalent
-- but structurally different v1 definitions.

SET lock_timeout = '2min';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_price_evidence_order_v2
  ON public.reviewed_workbook_inventory (
    (
      COALESCE(
        workbook_price_usd > 0 OR source_price_amount > 0,
        false
      )
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
  idx_reviewed_workbook_market_type_price_evidence_order_v2
  ON public.reviewed_workbook_inventory (
    listing_type,
    (
      COALESCE(
        workbook_price_usd > 0 OR source_price_amount > 0,
        false
      )
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

DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_market_price_evidence_order;
DROP INDEX CONCURRENTLY IF EXISTS
  public.idx_reviewed_workbook_market_type_price_evidence_order;

ANALYZE public.reviewed_workbook_inventory;

NOTIFY pgrst, 'reload schema';
