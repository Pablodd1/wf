-- Exact-reference Price Research acceleration for the reviewed-workbook source.
--
-- This migration is index-only. It does not modify source rows, normalize
-- evidence, change publication status, infer currency, or broaden analytics
-- eligibility. PostgreSQL must run CREATE INDEX CONCURRENTLY outside an
-- explicit transaction.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_verified_reference_wts
  ON public.reviewed_workbook_inventory (
    brand_scope,
    (
      regexp_replace(
        upper(COALESCE(normalized_reference, '')),
        '[^A-Z0-9]',
        '',
        'g'
      )
    ),
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type = 'WTS'
    AND COALESCE(
      price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
        AND workbook_price_usd > 0,
      false
    );

ANALYZE public.reviewed_workbook_inventory;

NOTIFY pgrst, 'reload schema';
