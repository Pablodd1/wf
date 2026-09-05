-- Customer Trading Floor order: every listing with a retained supplied price
-- precedes listings with no price. These are ordering indexes only; they do not
-- change, infer, approve, or publish any source value.
--
-- PostgreSQL forbids concurrent index creation inside a transaction.

SET lock_timeout = '2min';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_price_first
  ON public.reviewed_workbook_inventory (
    workbook_price_usd DESC NULLS LAST,
    source_price_amount DESC NULLS LAST,
    has_image DESC,
    posting_date DESC NULLS LAST,
    id
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_type_price_first
  ON public.reviewed_workbook_inventory (
    listing_type,
    workbook_price_usd DESC NULLS LAST,
    source_price_amount DESC NULLS LAST,
    has_image DESC,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_brand_price_first
  ON public.reviewed_workbook_inventory (
    brand_scope,
    workbook_price_usd DESC NULLS LAST,
    source_price_amount DESC NULLS LAST,
    has_image DESC,
    posting_date DESC NULLS LAST,
    id
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_brand_type_price_first
  ON public.reviewed_workbook_inventory (
    brand_scope,
    listing_type,
    workbook_price_usd DESC NULLS LAST,
    source_price_amount DESC NULLS LAST,
    has_image DESC,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

NOTIFY pgrst, 'reload schema';
