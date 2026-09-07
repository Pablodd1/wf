-- Reviewed forward-only definitions for the v2 publication canary.
-- IMPORTANT: this migration is intentionally committed but was not applied by
-- this review. It preserves existing view dependencies without destructive DDL.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

-- 1. Canary Published Listings Table v2 (Zero default 'WTS', allows NULL intent with review_status)
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_canary_published_listings_v2 (
  contract_version TEXT NOT NULL DEFAULT 'v2.0',
  listing_id TEXT PRIMARY KEY,
  parent_listing_id TEXT,
  child_index INT,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  raw_message_id TEXT NOT NULL,
  raw_message_text TEXT,
  source_context_text TEXT,
  source_created_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  category TEXT,
  brand TEXT,
  model TEXT,
  reference TEXT,
  dial_color TEXT,
  year INT,
  condition TEXT,
  intent TEXT,
  intent_status TEXT DEFAULT NULL,
  title TEXT,
  description TEXT,
  original_price_text TEXT,
  original_price_amount NUMERIC,
  original_price_currency TEXT,
  price_usd NUMERIC,
  fx_rate NUMERIC,
  fx_source TEXT,
  fx_date DATE,
  price_status TEXT,
  price_research_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  included_in_statistics BOOLEAN NOT NULL DEFAULT FALSE,
  statistics_exclusion_reason TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  image_key TEXT,
  image_evidence_type TEXT,
  image_status TEXT,
  seller_id TEXT,
  seller_display_name TEXT,
  seller_profile_url TEXT,
  seller_review_count INT,
  seller_listing_count INT,
  seller_wts_count INT,
  seller_wtb_count INT,
  contact_available BOOLEAN NOT NULL DEFAULT FALSE,
  location_country TEXT,
  location_region TEXT,
  is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
  bundle_child_count INT,
  duplicate_group_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'REVIEW_NOT_REQUIRED',
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  test_run_id VARCHAR(64)
);

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN intent DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN intent DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ADD COLUMN IF NOT EXISTS duplicate_group_id TEXT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN category DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN category DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_review_count DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_review_count DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_listing_count DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_listing_count DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_wts_count DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_wts_count DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_wtb_count DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN seller_wtb_count DROP NOT NULL;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN bundle_child_count DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
  ALTER COLUMN bundle_child_count DROP NOT NULL;

CREATE OR REPLACE FUNCTION wf_canonical_staging.trg_canary_listings_intent_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.intent IS NULL OR NEW.intent = '' THEN
    NEW.intent := NULL;
    IF NEW.intent_status IS NULL OR NEW.intent_status = '' THEN
      NEW.intent_status := 'INTENT_UNKNOWN';
    END IF;
    IF NEW.review_status IS NULL OR NEW.review_status = 'REVIEW_NOT_REQUIRED' THEN
      NEW.review_status := 'REVIEW_REQUIRED';
    END IF;
    IF NEW.review_reasons IS NULL OR NEW.review_reasons = '[]'::jsonb THEN
      NEW.review_reasons := '["UNKNOWN_OR_UNRESOLVED_INTENT"]'::jsonb;
    END IF;
    NEW.included_in_statistics := FALSE;
  ELSIF NEW.intent = 'WTB' THEN
    IF NEW.intent_status IS NULL OR NEW.intent_status = '' THEN
      NEW.intent_status := 'INTENT_EXPLICIT_WTB';
    END IF;
    NEW.included_in_statistics := FALSE;
  ELSIF NEW.intent = 'WTS' THEN
    IF NEW.intent_status IS NULL OR NEW.intent_status = '' THEN
      NEW.intent_status := 'INTENT_EXPLICIT_WTS';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canary_listings_intent_audit ON wf_canonical_staging.mariadb_canary_published_listings_v2;
CREATE TRIGGER trg_canary_listings_intent_audit
BEFORE INSERT OR UPDATE ON wf_canonical_staging.mariadb_canary_published_listings_v2
FOR EACH ROW EXECUTE FUNCTION wf_canonical_staging.trg_canary_listings_intent_audit();


-- 2. Normalized Proposals v2
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalized_proposals_v2 (
  source_id TEXT PRIMARY KEY,
  source_record_id TEXT,
  source_created_on TEXT,
  source_hash TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  reference TEXT,
  condition TEXT,
  intent TEXT DEFAULT NULL,
  price_usd NUMERIC,
  raw_payload JSONB,
  test_run_id VARCHAR(64)
);

-- 3. Bundle Children v2
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_bundle_children_v2 (
  child_listing_id TEXT PRIMARY KEY,
  parent_source_id TEXT NOT NULL,
  child_index INT NOT NULL,
  brand TEXT,
  model TEXT,
  reference TEXT,
  dial_color TEXT,
  condition TEXT,
  price_usd NUMERIC,
  evidence_source TEXT,
  test_run_id VARCHAR(64)
);

-- 4. Raw Partition Tables & Reconciliation Ledgers
CREATE TABLE IF NOT EXISTS wf_canonical_staging.raw_partition_alpha (
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  test_run_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS wf_canonical_staging.raw_partition_beta (
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  test_run_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS wf_canonical_staging.raw_duplicate_reconciliation_ledger (
  source_id TEXT NOT NULL,
  test_run_id VARCHAR(64),
  resolution_status TEXT NOT NULL,
  raw_count INT NOT NULL,
  distinct_hashes INT NOT NULL,
  source_hash TEXT,
  action TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf_canonical_staging.quarantined_conflicting_revisions (
  source_id TEXT NOT NULL,
  test_run_id VARCHAR(64),
  conflict_reason TEXT NOT NULL,
  partition_a TEXT,
  hash_a TEXT,
  timestamp_a TIMESTAMPTZ,
  partition_b TEXT,
  hash_b TEXT,
  timestamp_b TIMESTAMPTZ,
  remediation_status TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION wf_canonical_staging.reconcile_raw_partitions(p_test_run_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_reconciled INT := 0;
  v_quarantined INT := 0;
BEGIN
  -- 1. Exact matches (identical source_id and source_hash)
  INSERT INTO wf_canonical_staging.raw_duplicate_reconciliation_ledger
    (source_id, test_run_id, resolution_status, raw_count, distinct_hashes, source_hash, action, logged_at, resolved_at)
  SELECT
    a.source_id,
    p_test_run_id,
    'RECONCILED_EXACT_MATCH',
    2,
    1,
    a.source_hash,
    'DEDUPLICATED_LOSSLESS',
    now(),
    now()
  FROM wf_canonical_staging.raw_partition_alpha a
  JOIN wf_canonical_staging.raw_partition_beta b
    ON a.source_id = b.source_id
   AND a.source_hash = b.source_hash
   AND a.test_run_id = p_test_run_id
   AND b.test_run_id = p_test_run_id;

  GET DIAGNOSTICS v_reconciled = ROW_COUNT;

  -- 2. Conflicts (identical source_id, mismatched source_hash)
  INSERT INTO wf_canonical_staging.quarantined_conflicting_revisions
    (source_id, test_run_id, conflict_reason, partition_a, hash_a, timestamp_a, partition_b, hash_b, timestamp_b, remediation_status, quarantined_at)
  SELECT
    a.source_id,
    p_test_run_id,
    'PARTITION_HASH_MISMATCH',
    'raw_partition_alpha',
    a.source_hash,
    a.created_at,
    'raw_partition_beta',
    b.source_hash,
    b.created_at,
    'QUARANTINED_PENDING_MANUAL_REVIEW',
    now()
  FROM wf_canonical_staging.raw_partition_alpha a
  JOIN wf_canonical_staging.raw_partition_beta b
    ON a.source_id = b.source_id
   AND a.source_hash <> b.source_hash
   AND a.test_run_id = p_test_run_id
   AND b.test_run_id = p_test_run_id;

  GET DIAGNOSTICS v_quarantined = ROW_COUNT;

  RETURN jsonb_build_object(
    'reconciled_exact', v_reconciled,
    'quarantined_conflicts', v_quarantined
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supports the complete keyset order on the underlying relation. PostgreSQL
-- cannot index a normal view, so the expression index mirrors its rank fields.
CREATE INDEX IF NOT EXISTS idx_mariadb_canary_v2_display_keyset
ON wf_canonical_staging.mariadb_canary_published_listings_v2 (
  (CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END),
  (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
          AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END),
  price_usd DESC NULLS LAST,
  source_created_at DESC,
  listing_id ASC
);

CREATE INDEX IF NOT EXISTS idx_mariadb_canary_v2_exact_cohort
ON wf_canonical_staging.mariadb_canary_published_listings_v2 (
  lower(brand), lower(reference), lower(model), dial_color, condition
)
WHERE intent = 'WTS' AND price_research_eligible IS TRUE
  AND included_in_statistics IS TRUE AND price_usd > 0;

CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2
WITH (security_invoker = true) AS
SELECT
  contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
  raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
  category, brand, model, reference, dial_color, year, condition, intent, intent_status,
  title, description, original_price_text, original_price_amount, original_price_currency,
  price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
  included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
  image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
  seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
  contact_available, location_country, location_region, is_bundle, bundle_child_count,
  review_status, review_reasons,
  CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END AS priced_rank,
  CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
         AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END AS image_rank,
  duplicate_group_id
FROM wf_canonical_staging.mariadb_canary_published_listings_v2;

CREATE OR REPLACE VIEW public.price_research_ready_view_v2
WITH (security_invoker = true) AS
SELECT *
FROM public.trading_floor_ready_view_v2
WHERE price_research_eligible IS TRUE
  AND price_usd > 0
  AND (
    upper(original_price_currency) = 'USD'
    OR (
      upper(original_price_currency) <> 'USD'
      AND fx_rate > 0
      AND NULLIF(btrim(fx_source), '') IS NOT NULL
      AND fx_date IS NOT NULL
    )
  );

CREATE OR REPLACE VIEW public.listing_display_detail_view_v2
WITH (security_invoker = true) AS
SELECT * FROM public.trading_floor_ready_view_v2;

CREATE OR REPLACE VIEW public.seller_listing_analytics_view_v2
WITH (security_invoker = true) AS
SELECT
  seller_display_name,
  seller_id,
  count(*) AS total_listings,
  count(*) FILTER (WHERE intent = 'WTS') AS wts_count,
  count(*) FILTER (WHERE intent = 'WTB') AS wtb_count,
  count(*) FILTER (WHERE review_status = 'REVIEW_REQUIRED') AS review_count,
  bool_or(contact_available) AS any_contact_available
FROM wf_canonical_staging.mariadb_canary_published_listings_v2
GROUP BY seller_id, seller_display_name;

DROP FUNCTION IF EXISTS public.get_trading_floor_canary_keyset(integer,integer,integer,numeric,timestamptz,text);
CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_keyset(
  p_limit integer DEFAULT 50,
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_images_only boolean DEFAULT false,
  p_priced_only boolean DEFAULT false,
  p_cursor_priced_rank integer DEFAULT NULL,
  p_cursor_image_rank integer DEFAULT NULL,
  p_cursor_price_usd numeric DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_listing_id text DEFAULT NULL
)
RETURNS SETOF public.trading_floor_ready_view_v2
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied AND (
    p_cursor_priced_rank NOT IN (1, 2)
    OR p_cursor_image_rank NOT IN (1, 2)
    OR p_cursor_created_at IS NULL
    OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid composite cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM public.trading_floor_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (p_intent IS NULL OR v.intent = upper(p_intent))
    AND (p_category IS NULL
         OR lower(v.category) = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(v.category) = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(v.category) = 'watches'))
    AND (p_country IS NULL OR lower(v.location_country) = lower(p_country))
    AND (p_region IS NULL OR lower(v.location_region) = lower(p_region))
    AND (NOT p_images_only OR (v.image_status = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(v.image_key), '') IS NOT NULL))
    AND (NOT p_priced_only OR (v.price_usd IS NOT NULL AND v.price_usd > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(v.reference, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.model, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.title, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.brand, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.raw_message_text, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.seller_display_name, '')) LIKE '%' || lower(p_query) || '%'
    ))
    AND (NOT cursor_supplied OR (
         v.priced_rank > p_cursor_priced_rank
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank > p_cursor_image_rank)
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND (p_cursor_price_usd IS NOT NULL AND (v.price_usd < p_cursor_price_usd OR v.price_usd IS NULL)))
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND v.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND v.source_created_at < p_cursor_created_at)
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND v.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND v.source_created_at = p_cursor_created_at
          AND v.listing_id > p_cursor_listing_id)
    ))
  ORDER BY v.priced_rank ASC, v.image_rank ASC,
           v.price_usd DESC NULLS LAST, v.source_created_at DESC, v.listing_id ASC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_count(
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_images_only boolean DEFAULT false,
  p_priced_only boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.trading_floor_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (p_intent IS NULL OR v.intent = upper(p_intent))
    AND (p_category IS NULL
         OR lower(v.category) = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(v.category) = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(v.category) = 'watches'))
    AND (p_country IS NULL OR lower(v.location_country) = lower(p_country))
    AND (p_region IS NULL OR lower(v.location_region) = lower(p_region))
    AND (NOT p_images_only OR (v.image_status = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(v.image_key), '') IS NOT NULL))
    AND (NOT p_priced_only OR (v.price_usd IS NOT NULL AND v.price_usd > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(v.reference, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.model, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.title, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.brand, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.raw_message_text, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.seller_display_name, '')) LIKE '%' || lower(p_query) || '%'
    ));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_price_research_canary_keyset_v2(
  p_limit integer DEFAULT 50,
  p_brand text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false,
  p_cursor_priced_rank integer DEFAULT NULL,
  p_cursor_image_rank integer DEFAULT NULL,
  p_cursor_price_usd numeric DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_listing_id text DEFAULT NULL
)
RETURNS SETOF public.price_research_ready_view_v2
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied AND (
    p_cursor_priced_rank NOT IN (1, 2)
    OR p_cursor_image_rank NOT IN (1, 2)
    OR p_cursor_created_at IS NULL
    OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid composite cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM public.price_research_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
    AND (NOT cursor_supplied OR (
         v.priced_rank > p_cursor_priced_rank
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank > p_cursor_image_rank)
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND (p_cursor_price_usd IS NOT NULL AND (v.price_usd < p_cursor_price_usd OR v.price_usd IS NULL)))
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND v.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND v.source_created_at < p_cursor_created_at)
      OR (v.priced_rank = p_cursor_priced_rank AND v.image_rank = p_cursor_image_rank
          AND v.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND v.source_created_at = p_cursor_created_at
          AND v.listing_id > p_cursor_listing_id)
    ))
  ORDER BY v.priced_rank ASC, v.image_rank ASC,
           v.price_usd DESC NULLS LAST, v.source_created_at DESC, v.listing_id ASC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_price_research_scoped_stats_v2(
  p_brand text,
  p_reference text,
  p_model text,
  p_dial_color text,
  p_condition text
)
RETURNS TABLE (
  qualified_count bigint, avg_price numeric, min_price numeric, max_price numeric,
  median_price numeric, q1_price numeric, q3_price numeric, iqr numeric,
  lower_fence numeric, upper_fence numeric, iqr_multiplier numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NULLIF(btrim(p_brand), '') IS NULL
     OR (NULLIF(btrim(p_reference), '') IS NULL AND NULLIF(btrim(p_model), '') IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH deduplicated AS (
    SELECT DISTINCT ON (
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      )
    ) v.price_usd
    FROM public.price_research_ready_view_v2 v
    WHERE v.intent = 'WTS'
      AND v.price_research_eligible IS TRUE
      AND v.price_usd > 0
      AND (
        upper(v.original_price_currency) = 'USD'
        OR (
          upper(v.original_price_currency) <> 'USD'
          AND v.fx_rate > 0
          AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
          AND v.fx_date IS NOT NULL
        )
      )
      AND lower(v.brand) = lower(p_brand)
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND v.dial_color IS NOT DISTINCT FROM p_dial_color
      AND v.condition IS NOT DISTINCT FROM p_condition
    ORDER BY (
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      )
    ), v.source_created_at DESC, v.listing_id ASC
  ), quartiles AS (
    SELECT
      count(*)::bigint AS raw_count,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_usd)::numeric AS q1,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY price_usd)::numeric AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_usd)::numeric AS q3
    FROM deduplicated
  ), fences AS (
    SELECT
      q.raw_count,
      q.q1,
      q.median,
      q.q3,
      (q.q3 - q.q1) AS iqr,
      greatest(0, q.q1 - 3.0 * (q.q3 - q.q1)) AS lower_fence,
      q.q3 + 3.0 * (q.q3 - q.q1) AS upper_fence
    FROM quartiles q
    WHERE q.raw_count >= 2
  ), included AS (
    SELECT
      d.price_usd,
      f.q1,
      f.median,
      f.q3,
      f.iqr,
      f.lower_fence,
      f.upper_fence
    FROM deduplicated d
    CROSS JOIN fences f
    WHERE d.price_usd >= f.lower_fence AND d.price_usd <= f.upper_fence
  ), aggregated AS (
    SELECT
      count(*)::bigint AS cnt,
      avg(i.price_usd) AS avg_value,
      min(i.price_usd) AS min_value,
      max(i.price_usd) AS max_value,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY i.price_usd)::numeric AS included_median,
      max(i.q1) AS q1,
      max(i.q3) AS q3,
      max(i.iqr) AS iqr,
      max(i.lower_fence) AS lower_fence,
      max(i.upper_fence) AS upper_fence
    FROM included i
  )
  SELECT
    a.cnt AS qualified_count,
    round(a.avg_value, 2) AS avg_price,
    a.min_value AS min_price,
    a.max_value AS max_price,
    round(a.included_median, 2) AS median_price,
    round(a.q1, 2) AS q1_price,
    round(a.q3, 2) AS q3_price,
    round(a.iqr, 2) AS iqr,
    round(a.lower_fence, 2) AS lower_fence,
    round(a.upper_fence, 2) AS upper_fence,
    3.0::numeric AS iqr_multiplier
  FROM aggregated a
  WHERE a.cnt >= 2;
END;
$$;

-- Exact condition facets/counts RPC
CREATE OR REPLACE FUNCTION public.get_price_research_condition_facets_v2(
  p_brand text,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false
)
RETURNS TABLE (
  condition text,
  listing_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(v.condition, 'Unspecified') AS condition,
    count(*)::bigint AS listing_count
  FROM public.price_research_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
  GROUP BY COALESCE(v.condition, 'Unspecified')
  ORDER BY listing_count DESC, condition ASC;
END;
$$;

-- Full-cohort breakdown counts RPC
CREATE OR REPLACE FUNCTION public.get_price_research_cohort_breakdown_v2(
  p_brand text,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS TABLE (
  total_listings bigint,
  wts_count bigint,
  wtb_count bigint,
  qualified_wts_count bigint,
  retained_audit_evidence_count bigint,
  iqr_outliers_count bigint,
  excluded_not_wts bigint,
  excluded_unresolved_currency bigint,
  excluded_ineligible_flag bigint,
  excluded_duplicate_repost bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_total bigint := 0;
  v_wts bigint := 0;
  v_wtb bigint := 0;
  v_qualified bigint := 0;
  v_retained bigint := 0;
  v_outliers bigint := 0;
  v_ex_not_wts bigint := 0;
  v_ex_unresolved_curr bigint := 0;
  v_ex_ineligible bigint := 0;
  v_ex_repost bigint := 0;
BEGIN
  -- 1. Total matching listings on Trading Floor
  SELECT count(*),
         count(*) FILTER (WHERE v.intent = 'WTS'),
         count(*) FILTER (WHERE v.intent = 'WTB'),
         count(*) FILTER (WHERE v.intent <> 'WTS')
  INTO v_total, v_wts, v_wtb, v_ex_not_wts
  FROM public.trading_floor_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 2. Currency and eligibility exclusions among WTS listings
  SELECT count(*) FILTER (WHERE upper(COALESCE(v.original_price_currency, '')) NOT IN ('USD') AND (v.fx_rate IS NULL OR v.fx_rate <= 0)),
         count(*) FILTER (WHERE v.price_research_eligible IS NOT TRUE OR v.price_usd IS NULL OR v.price_usd <= 0)
  INTO v_ex_unresolved_curr, v_ex_ineligible
  FROM public.trading_floor_ready_view_v2 v
  WHERE v.intent = 'WTS'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 3. Repost deduplication and stats fences for WTS Price Research candidates
  WITH candidate_wts AS (
    SELECT v.listing_id, v.price_usd,
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      ) AS group_key
    FROM public.price_research_ready_view_v2 v
    WHERE v.intent = 'WTS'
      AND v.price_research_eligible IS TRUE
      AND v.price_usd > 0
      AND (
        upper(v.original_price_currency) = 'USD'
        OR (
          upper(v.original_price_currency) <> 'USD'
          AND v.fx_rate > 0
          AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
          AND v.fx_date IS NOT NULL
        )
      )
      AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
      AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  ),
  deduped AS (
    SELECT DISTINCT ON (c.group_key) c.listing_id, c.price_usd
    FROM candidate_wts c
    ORDER BY c.group_key, c.listing_id ASC
  ),
  counts AS (
    SELECT (SELECT count(*) FROM candidate_wts) AS total_cand,
           (SELECT count(*) FROM deduped) AS dedup_cand
  ),
  quartiles AS (
    SELECT
      count(*)::bigint AS cnt,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_usd)::numeric AS q1,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_usd)::numeric AS q3
    FROM deduped
  ),
  fences AS (
    SELECT
      greatest(0, q1 - 3.0 * (q3 - q1)) AS lower_fence,
      q3 + 3.0 * (q3 - q1) AS upper_fence
    FROM quartiles
    WHERE cnt >= 2
  )
  SELECT
    (SELECT total_cand - dedup_cand FROM counts),
    (SELECT dedup_cand FROM counts),
    COALESCE((SELECT count(*) FROM deduped d CROSS JOIN fences f WHERE d.price_usd >= f.lower_fence AND d.price_usd <= f.upper_fence), (SELECT dedup_cand FROM counts)),
    COALESCE((SELECT count(*) FROM deduped d CROSS JOIN fences f WHERE d.price_usd < f.lower_fence OR d.price_usd > f.upper_fence), 0)
  INTO v_ex_repost, v_qualified, v_retained, v_outliers;

  RETURN QUERY
  SELECT
    v_total,
    v_wts,
    v_wtb,
    v_qualified,
    v_retained,
    v_outliers,
    v_ex_not_wts,
    v_ex_unresolved_curr,
    v_ex_ineligible,
    v_ex_repost;
END;
$$;


-- Dedicated server-side WTB demand RPC
CREATE OR REPLACE FUNCTION public.get_price_research_wtb_demand_v2(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_brand text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS SETOF public.trading_floor_ready_view_v2
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid offset' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM public.trading_floor_ready_view_v2 v
  WHERE v.intent = 'WTB'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  ORDER BY v.source_created_at DESC, v.listing_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Dedicated server-side WTS count RPC
CREATE OR REPLACE FUNCTION public.get_price_research_wts_count(
  p_brand text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.price_research_ready_view_v2 v
  WHERE v.intent = 'WTS'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);
  RETURN v_count;
END;
$$;

-- Dedicated server-side WTB count RPC
CREATE OR REPLACE FUNCTION public.get_price_research_wtb_count(
  p_brand text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.trading_floor_ready_view_v2 v
  WHERE v.intent = 'WTB'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);
  RETURN v_count;
END;
$$;

REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM service_role;
GRANT SELECT ON wf_canonical_staging.mariadb_canary_published_listings_v2 TO service_role;
GRANT EXECUTE ON FUNCTION wf_canonical_staging.reconcile_raw_partitions(text) TO service_role;

REVOKE ALL ON public.trading_floor_ready_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.price_research_ready_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.listing_display_detail_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_listing_analytics_view_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trading_floor_ready_view_v2, public.price_research_ready_view_v2,
  public.listing_display_detail_view_v2, public.seller_listing_analytics_view_v2 TO service_role;

REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset(integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_count(text,text,text,text,text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v2(integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wtb_demand_v2(integer,integer,text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wts_count(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wtb_count(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_condition_facets_v2(text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_cohort_breakdown_v2(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset(integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_count(text,text,text,text,text,text,text,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v2(integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_demand_v2(integer,integer,text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wts_count(text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_count(text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_condition_facets_v2(text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_cohort_breakdown_v2(text,text,text,text,boolean,text,boolean) TO service_role;

COMMIT;

