-- Customer-market projection and concurrent expression indexes. The source
-- table remains immutable evidence; unresolved workbook USD never participates
-- in customer ordering.

CREATE OR REPLACE VIEW public.reviewed_workbook_market_source
WITH (security_invoker = true)
AS
SELECT
  inventory.id,
  inventory.source_file,
  inventory.source_row_number,
  inventory.source_record_id,
  inventory.posting_date,
  inventory.posted_by,
  inventory.phone_number,
  inventory.contact_publication_approved,
  inventory.raw_message,
  inventory.listing_type,
  inventory.brand_scope,
  inventory.supplied_brand,
  inventory.canonical_brand,
  inventory.model,
  inventory.catalog_model,
  inventory.raw_reference,
  inventory.normalized_reference,
  inventory.catalog_reference,
  inventory.dial_color,
  inventory.catalog_dial,
  inventory.condition,
  inventory.workbook_price_usd,
  inventory.source_price_amount,
  inventory.source_price_text,
  inventory.source_currency,
  inventory.price_evidence_status,
  inventory.confidence,
  inventory.verification_status,
  inventory.user_image_url,
  inventory.imported_at,
  COALESCE(
    NULLIF(btrim(inventory.user_image_url), '') ~* '^https?://[^[:space:]]+$',
    false
  ) AS has_exact_source_image,
  COALESCE(
    inventory.price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
      AND inventory.workbook_price_usd > 0,
    false
  ) AS has_verified_usd_price,
  CASE
    WHEN inventory.price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'
      AND inventory.workbook_price_usd > 0
    THEN inventory.workbook_price_usd
    ELSE NULL
  END AS verified_price_usd,
  regexp_replace(
    upper(COALESCE(inventory.normalized_reference, '')),
    '[^A-Z0-9]',
    '',
    'g'
  ) AS reference_search_key
FROM public.reviewed_workbook_inventory AS inventory;

REVOKE ALL ON public.reviewed_workbook_market_source
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reviewed_workbook_market_source TO service_role;

COMMENT ON VIEW public.reviewed_workbook_market_source IS
  'Service-only customer projection. Exact source images and source-verified USD are the only image/price ordering evidence.';

-- Every statement is autocommitted by psql. CREATE INDEX CONCURRENTLY must not
-- be wrapped in a transaction on this multi-million-row table.
SET lock_timeout = '2min';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_evidence_order
  ON public.reviewed_workbook_inventory (
    (COALESCE(NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$', false)) DESC,
    (COALESCE(price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0, false)) DESC,
    (CASE WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0 THEN workbook_price_usd ELSE NULL END) DESC NULLS LAST,
    posting_date DESC NULLS LAST,
    id
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_brand_evidence_order
  ON public.reviewed_workbook_inventory (
    brand_scope,
    (COALESCE(NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$', false)) DESC,
    (COALESCE(price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0, false)) DESC,
    (CASE WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0 THEN workbook_price_usd ELSE NULL END) DESC NULLS LAST,
    posting_date DESC NULLS LAST,
    id
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_type_evidence_order
  ON public.reviewed_workbook_inventory (
    listing_type,
    (COALESCE(NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$', false)) DESC,
    (COALESCE(price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0, false)) DESC,
    (CASE WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0 THEN workbook_price_usd ELSE NULL END) DESC NULLS LAST,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_brand_type_evidence_order
  ON public.reviewed_workbook_inventory (
    brand_scope,
    listing_type,
    (COALESCE(NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$', false)) DESC,
    (COALESCE(price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0, false)) DESC,
    (CASE WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0 THEN workbook_price_usd ELSE NULL END) DESC NULLS LAST,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_market_reference_evidence_order
  ON public.reviewed_workbook_inventory (
    (regexp_replace(upper(COALESCE(normalized_reference, '')), '[^A-Z0-9]', '', 'g')),
    (COALESCE(NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$', false)) DESC,
    (COALESCE(price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0, false)) DESC,
    (CASE WHEN price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH' AND workbook_price_usd > 0 THEN workbook_price_usd ELSE NULL END) DESC NULLS LAST,
    posting_date DESC NULLS LAST,
    id
  );

NOTIFY pgrst, 'reload schema';
