-- Concurrent indexes for public ordering/filtering and exact approved-contact
-- activity. This migration intentionally has no transaction: PostgreSQL does
-- not permit CREATE INDEX CONCURRENTLY inside a transaction block.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_approved_phone_activity
  ON public.reviewed_workbook_inventory (
    phone_number,
    posting_date,
    listing_type,
    id
  )
  INCLUDE (posted_by)
  WHERE contact_publication_approved IS TRUE
    AND phone_number IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_type_order
  ON public.reviewed_workbook_inventory (
    listing_type,
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_brand_type_order
  ON public.reviewed_workbook_inventory (
    brand_scope,
    listing_type,
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_reference_order
  ON public.reviewed_workbook_inventory (
    normalized_reference,
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  )
  WHERE normalized_reference IS NOT NULL;
