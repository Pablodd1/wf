-- Customer-market projection and concurrent expression indexes. The source
-- table remains immutable evidence; unresolved workbook USD and contaminated
-- reference tokens never qualify for Price Research.

CREATE OR REPLACE FUNCTION public.reviewed_workbook_reference_key_v2(p_reference text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT NULLIF(
    regexp_replace(upper(COALESCE(p_reference, '')), '[^A-Z0-9]', '', 'g'),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.reviewed_workbook_reference_is_price_token_v2(
  p_reference text,
  p_source_amount numeric,
  p_source_currency text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH evidence AS (
    SELECT
      public.reviewed_workbook_reference_key_v2(p_reference) AS reference_key,
      CASE
        WHEN p_source_amount IS NULL OR p_source_amount <= 0 THEN NULL
        WHEN scale(p_source_amount) > 0 THEN regexp_replace(
          rtrim(rtrim(p_source_amount::text, '0'), '.'),
          '[^0-9]',
          '',
          'g'
        )
        ELSE regexp_replace(p_source_amount::text, '[^0-9]', '', 'g')
      END AS amount_key,
      NULLIF(
        regexp_replace(upper(COALESCE(p_source_currency, '')), '[^A-Z]', '', 'g'),
        ''
      ) AS currency_key
  )
  SELECT COALESCE(
    reference_key ~ '^(USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)[0-9]+$'
    OR reference_key ~ '^[0-9]+(USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)$'
    OR (
      amount_key IS NOT NULL
      AND currency_key IS NOT NULL
      AND reference_key IN (amount_key || currency_key, currency_key || amount_key)
    ),
    false
  )
  FROM evidence;
$function$;

CREATE OR REPLACE FUNCTION public.reviewed_workbook_identity_complete_v2(
  p_brand text,
  p_model text,
  p_reference text,
  p_dial text,
  p_source_amount numeric,
  p_source_currency text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(p_brand), '') IS NOT NULL
    AND btrim(p_brand) !~* '^(unknown|null|n/a)$'
    AND NULLIF(btrim(p_model), '') IS NOT NULL
    AND btrim(p_model) !~* '^(unknown|null|n/a)$'
    AND NULLIF(btrim(p_reference), '') IS NOT NULL
    AND btrim(p_reference) !~* '^(unknown|null|n/a)$'
    AND NULLIF(btrim(p_dial), '') IS NOT NULL
    AND btrim(p_dial) !~* '^(unknown|null|n/a)$'
    AND NOT public.reviewed_workbook_reference_is_price_token_v2(
      p_reference,
      p_source_amount,
      p_source_currency
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.reviewed_workbook_reference_key_v2(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reviewed_workbook_reference_is_price_token_v2(text, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reviewed_workbook_identity_complete_v2(text, text, text, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reviewed_workbook_reference_key_v2(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reviewed_workbook_reference_is_price_token_v2(text, numeric, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reviewed_workbook_identity_complete_v2(text, text, text, text, numeric, text)
  TO service_role;

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
  ) AS reference_search_key,
  CASE
    WHEN public.reviewed_workbook_reference_is_price_token_v2(
      COALESCE(
        inventory.normalized_reference,
        inventory.raw_reference,
        inventory.catalog_reference
      ),
      inventory.source_price_amount,
      inventory.source_currency
    ) THEN NULL
    ELSE COALESCE(
      inventory.normalized_reference,
      inventory.raw_reference,
      inventory.catalog_reference
    )
  END AS public_reference,
  public.reviewed_workbook_reference_is_price_token_v2(
    COALESCE(
      inventory.normalized_reference,
      inventory.raw_reference,
      inventory.catalog_reference
    ),
    inventory.source_price_amount,
    inventory.source_currency
  ) AS reference_is_price_token,
  public.reviewed_workbook_identity_complete_v2(
    COALESCE(inventory.supplied_brand, inventory.canonical_brand, inventory.brand_scope),
    COALESCE(inventory.model, inventory.catalog_model),
    COALESCE(
      inventory.normalized_reference,
      inventory.raw_reference,
      inventory.catalog_reference
    ),
    COALESCE(inventory.dial_color, inventory.catalog_dial),
    inventory.source_price_amount,
    inventory.source_currency
  ) AS has_complete_identity
FROM public.reviewed_workbook_inventory AS inventory;

REVOKE ALL ON public.reviewed_workbook_market_source
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reviewed_workbook_market_source TO service_role;

COMMENT ON VIEW public.reviewed_workbook_market_source IS
  'Service-only customer projection. Identity and price eligibility fail closed without rebuilding the existing customer-order indexes.';

-- Reuse the already-built v1 customer-order indexes. Remove only abandoned v2
-- artifacts; never rebuild or drop the production v1 indexes in this migration.
SET lock_timeout = '2min';
SET statement_timeout = '0';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_reviewed_workbook_market_evidence_order_v2;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reviewed_workbook_market_brand_evidence_order_v2;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reviewed_workbook_market_type_evidence_order_v2;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reviewed_workbook_market_brand_type_evidence_order_v2;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reviewed_workbook_market_reference_evidence_order_v2;

NOTIFY pgrst, 'reload schema';
