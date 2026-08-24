-- Phase 7B: private, parallel Price Research verification layer.
-- This migration never updates staging.listings, raw_message_versions, a
-- customer endpoint, or a customer-visible view.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS price_research_shadow;

REVOKE ALL ON SCHEMA price_research_shadow FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA price_research_shadow TO service_role;

CREATE TABLE price_research_shadow.runs (
  run_key text PRIMARY KEY CHECK (run_key ~ '^phase7b-[a-z0-9][a-z0-9._-]{5,100}$'),
  contract text NOT NULL,
  project_ref text NOT NULL CHECK (project_ref = 'qnsafosakvonzgfcsphh'),
  source_run_key text NOT NULL,
  parser_version text NOT NULL CHECK (parser_version = 'price-parser-v5-shadow'),
  fx_contract text NOT NULL DEFAULT 'wf-phase7b-ecb-historical-previous-published-day-v1'
    CHECK (fx_contract = 'wf-phase7b-ecb-historical-previous-published-day-v1'),
  catalog_sha256 text NOT NULL CHECK (catalog_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','RECONCILING','COMPLETE','FAILED')),
  source_observation_count bigint,
  processed_observation_count bigint NOT NULL DEFAULT 0,
  verified_observation_count bigint NOT NULL DEFAULT 0,
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE price_research_shadow.catalog_references (
  run_key text NOT NULL REFERENCES price_research_shadow.runs(run_key) ON DELETE RESTRICT,
  brand text NOT NULL CHECK (brand IN ('Rolex','Patek Philippe')),
  canonical_model text NOT NULL,
  canonical_reference text NOT NULL,
  reference_key text NOT NULL,
  catalog_entry_sha256 text NOT NULL CHECK (catalog_entry_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (run_key, brand, canonical_reference),
  UNIQUE (run_key, brand, reference_key)
);

CREATE TABLE price_research_shadow.observations (
  run_key text NOT NULL REFERENCES price_research_shadow.runs(run_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL,
  source_record_id text,
  raw_message_version_id uuid,
  source_hash text CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
  source_candidate_hash text CHECK (source_candidate_hash IS NULL OR source_candidate_hash ~ '^[0-9a-f]{64}$'),
  brand text NOT NULL CHECK (brand IN ('Rolex','Patek Philippe')),
  canonical_model text,
  canonical_reference text,
  intent text NOT NULL CHECK (intent = 'WTS'),
  source_amount numeric,
  source_currency text,
  parser_version text NOT NULL CHECK (parser_version = 'price-parser-v5-shadow'),
  parser_rule text,
  source_span_start integer,
  source_span_end integer,
  source_span_sha256 text CHECK (source_span_sha256 IS NULL OR source_span_sha256 ~ '^[0-9a-f]{64}$'),
  price_evidence_classification text NOT NULL CHECK (price_evidence_classification IN (
    'VERIFIED_IN_NEW_COHORT','LEGACY_USD_DEFAULTED','BARE_DOLLAR_AMBIGUOUS',
    'CURRENCYLESS_AMOUNT','CURRENCYLESS_KM','FX_PROVENANCE_MISSING','FX_INVALID',
    'MULTIPLE_PRICE_AMBIGUOUS','BUNDLE_PRICE_AMBIGUOUS','SOURCE_PRICE_CONFLICT',
    'REFERENCE_INVALID','REFERENCE_AMBIGUOUS','SOURCE_NOT_RECONCILABLE',
    'REVIEW_REQUIRED','OTHER')),
  fx_provider text,
  fx_rate numeric,
  fx_effective_date date,
  fx_applicable_date date,
  fx_contract text,
  fx_rate_direction text,
  fx_source_url text,
  stored_fx_comparison jsonb,
  verified_usd_amount numeric,
  current_usd_amount numeric NOT NULL CHECK (current_usd_amount > 0),
  qualification_reason text,
  exclusion_reason text,
  dedupe_status text NOT NULL,
  observation_sha256 text NOT NULL CHECK (observation_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, listing_id),
  CHECK ((price_evidence_classification = 'VERIFIED_IN_NEW_COHORT') =
    (verified_usd_amount > 0 AND source_amount > 0 AND source_currency IS NOT NULL
      AND source_record_id IS NOT NULL AND raw_message_version_id IS NOT NULL AND source_hash IS NOT NULL
      AND canonical_reference IS NOT NULL AND source_span_sha256 IS NOT NULL
      AND qualification_reason IS NOT NULL AND exclusion_reason IS NULL)),
  CHECK (source_currency IS NULL OR source_currency = upper(source_currency)),
  CHECK (source_currency IN ('USD','USDT') OR verified_usd_amount IS NULL OR
    (fx_provider = 'European Central Bank reference rates' AND fx_rate > 0
      AND fx_effective_date IS NOT NULL AND fx_applicable_date IS NOT NULL
      AND fx_effective_date BETWEEN fx_applicable_date - 7 AND fx_applicable_date
      AND fx_contract = 'wf-phase7b-ecb-historical-previous-published-day-v1'
      AND fx_rate_direction = 'USD_PER_SOURCE_UNIT'
      AND fx_source_url = 'https://data.ecb.europa.eu/data/datasets/EXR'))
);

CREATE INDEX phase7b_observations_classification
  ON price_research_shadow.observations(run_key, brand, price_evidence_classification);
CREATE INDEX phase7b_observations_reference
  ON price_research_shadow.observations(run_key, brand, canonical_reference)
  INCLUDE (verified_usd_amount, current_usd_amount);
CREATE INDEX phase7b_observations_lineage
  ON price_research_shadow.observations(raw_message_version_id, source_hash);

CREATE TABLE price_research_shadow.checkpoints (
  run_key text NOT NULL REFERENCES price_research_shadow.runs(run_key) ON DELETE RESTRICT,
  brand text NOT NULL CHECK (brand IN ('Rolex','Patek Philippe')),
  batch_number integer NOT NULL CHECK (batch_number > 0),
  first_listing_id uuid NOT NULL,
  last_listing_id uuid NOT NULL,
  input_rows integer NOT NULL CHECK (input_rows BETWEEN 1 AND 500),
  inserted_rows integer NOT NULL CHECK (inserted_rows BETWEEN 0 AND 500),
  batch_sha256 text NOT NULL CHECK (batch_sha256 ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, brand, batch_number),
  UNIQUE (run_key, brand, batch_sha256)
);

CREATE TABLE price_research_shadow.reference_census (
  run_key text NOT NULL REFERENCES price_research_shadow.runs(run_key) ON DELETE RESTRICT,
  brand text NOT NULL,
  canonical_model text NOT NULL,
  canonical_reference text NOT NULL,
  publication_contract text NOT NULL,
  total_published_listings bigint NOT NULL,
  wts_listings bigint NOT NULL,
  wtb_listings bigint NOT NULL,
  priced_listings bigint NOT NULL,
  image_linked_listings bigint NOT NULL,
  legacy_pr_observations bigint NOT NULL,
  verified_pr_observations bigint NOT NULL,
  review_required_observations bigint NOT NULL,
  excluded_observations bigint NOT NULL,
  current_observation_count bigint NOT NULL,
  current_qualified_comparable_count bigint NOT NULL,
  current_median numeric,
  current_mean numeric,
  current_min numeric,
  current_max numeric,
  current_analytics_ready boolean NOT NULL,
  verified_observation_count bigint NOT NULL,
  verified_qualified_comparable_count bigint NOT NULL,
  verified_median numeric,
  verified_mean numeric,
  verified_min numeric,
  verified_max numeric,
  verified_analytics_ready boolean NOT NULL,
  census_sha256 text NOT NULL CHECK (census_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (run_key, brand, canonical_reference)
);

CREATE INDEX phase7b_reference_census_lookup
  ON price_research_shadow.reference_census(run_key, brand, canonical_reference);

CREATE TABLE price_research_shadow.price_rating_impact (
  run_key text NOT NULL REFERENCES price_research_shadow.runs(run_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL,
  brand text NOT NULL,
  canonical_reference text NOT NULL,
  dial_key text NOT NULL,
  listing_price_usd numeric NOT NULL,
  current_comparable_count bigint NOT NULL,
  verified_comparable_count bigint NOT NULL,
  current_rating text NOT NULL CHECK (current_rating IN ('GOOD','MARKET','HIGH','NOT_RATED')),
  verified_rating text NOT NULL CHECK (verified_rating IN ('GOOD','MARKET','HIGH','NOT_RATED')),
  impact_class text NOT NULL CHECK (impact_class IN (
    'UNCHANGED','CHANGED','OPEN_FOR_RATING','CURRENTLY_RATED_FROM_UNTRUSTED_BENCHMARK')),
  impact_sha256 text NOT NULL CHECK (impact_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (run_key, listing_id)
);

CREATE INDEX phase7b_rating_impact_summary
  ON price_research_shadow.price_rating_impact(run_key, brand, impact_class);

ALTER TABLE price_research_shadow.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_research_shadow.catalog_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_research_shadow.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_research_shadow.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_research_shadow.reference_census ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_research_shadow.price_rating_impact ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA price_research_shadow FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA price_research_shadow TO service_role;

CREATE OR REPLACE FUNCTION public.begin_phase7b_verified_price_shadow(
  p_run_key text,
  p_contract text,
  p_parser_version text,
  p_catalog_sha256 text,
  p_catalog jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, staging, price_research_shadow, pg_catalog
AS $function$
DECLARE v_source_run_key text; v_entry jsonb; v_catalog_count integer := 0; v_source_count bigint;
  v_existing_contract text; v_existing_source_run_key text; v_existing_parser text;
  v_existing_catalog_sha text; v_existing_status text; v_existing_source_count bigint;
BEGIN
  IF p_contract <> 'watchfacts-phase7b-verified-price-research-shadow-v1'
    OR p_parser_version <> 'price-parser-v5-shadow'
    OR p_catalog_sha256 !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_catalog) <> 'array' OR jsonb_array_length(p_catalog) < 2 THEN
    RAISE EXCEPTION 'Invalid Phase 7B run contract';
  END IF;
  SELECT enabled_run_key INTO v_source_run_key
  FROM public.qnsa_market_feed_control WHERE singleton AND enabled;
  IF v_source_run_key IS NULL THEN RAISE EXCEPTION 'Canonical QNSA feed is not enabled'; END IF;

  SELECT count(*) INTO v_source_count
  FROM staging.listings l
  WHERE l.normalization_run_key = v_source_run_key
    AND l.brand_normalized IN ('Rolex','Patek Philippe')
    AND upper(COALESCE(l.listing_type,l.intent,'')) = 'WTS'
    AND l.price_usd > 0
    AND lower(COALESCE(l.price_research_status,'')) <> 'suppressed_exact_duplicate';

  INSERT INTO price_research_shadow.runs(run_key,contract,project_ref,source_run_key,
    parser_version,catalog_sha256,source_observation_count)
  VALUES(p_run_key,p_contract,'qnsafosakvonzgfcsphh',v_source_run_key,
    p_parser_version,p_catalog_sha256,v_source_count)
  ON CONFLICT (run_key) DO NOTHING;

  SELECT contract,source_run_key,parser_version,catalog_sha256,status,source_observation_count
    INTO v_existing_contract,v_existing_source_run_key,v_existing_parser,v_existing_catalog_sha,v_existing_status,
      v_existing_source_count
  FROM price_research_shadow.runs WHERE run_key=p_run_key;
  IF v_existing_contract IS DISTINCT FROM p_contract
    OR v_existing_source_run_key IS DISTINCT FROM v_source_run_key
    OR v_existing_parser IS DISTINCT FROM p_parser_version
    OR v_existing_catalog_sha IS DISTINCT FROM p_catalog_sha256
    OR v_existing_source_count IS DISTINCT FROM v_source_count
    OR v_existing_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Existing Phase 7B run does not match the resumable contract';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_catalog) LOOP
    IF v_entry->>'brand' NOT IN ('Rolex','Patek Philippe')
      OR NULLIF(btrim(v_entry->>'model'),'') IS NULL
      OR NULLIF(btrim(v_entry->>'reference'),'') IS NULL
      OR (v_entry->>'entry_sha256') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid Phase 7B catalog entry';
    END IF;
    INSERT INTO price_research_shadow.catalog_references(run_key,brand,canonical_model,
      canonical_reference,reference_key,catalog_entry_sha256)
    VALUES(p_run_key,v_entry->>'brand',v_entry->>'model',v_entry->>'reference',
      regexp_replace(upper(v_entry->>'reference'),'[^A-Z0-9]','','g'),v_entry->>'entry_sha256')
    ON CONFLICT (run_key,brand,canonical_reference) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM price_research_shadow.catalog_references c
      WHERE c.run_key=p_run_key AND c.brand=v_entry->>'brand'
        AND c.canonical_model=v_entry->>'model' AND c.canonical_reference=v_entry->>'reference'
        AND c.reference_key=regexp_replace(upper(v_entry->>'reference'),'[^A-Z0-9]','','g')
        AND c.catalog_entry_sha256=v_entry->>'entry_sha256'
    ) THEN RAISE EXCEPTION 'Existing Phase 7B catalog entry does not match resumable input'; END IF;
    v_catalog_count := v_catalog_count + 1;
  END LOOP;
  RETURN jsonb_build_object('run_key',p_run_key,'source_run_key',v_source_run_key,
    'source_observations',v_source_count,'catalog_references',v_catalog_count,'status','RUNNING');
END;
$function$;

CREATE OR REPLACE FUNCTION public.phase7b_verified_price_source_page(
  p_run_key text, p_brand text, p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 250
) RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, staging, price_research_shadow, pg_catalog
AS $function$
DECLARE v_source_run_key text;
BEGIN
  IF p_brand NOT IN ('Rolex','Patek Philippe') OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid Phase 7B page request'; END IF;
  SELECT source_run_key INTO v_source_run_key FROM price_research_shadow.runs
    WHERE run_key=p_run_key AND status='RUNNING';
  IF v_source_run_key IS NULL THEN RAISE EXCEPTION 'Phase 7B run is not running'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'listing_id',l.id,'source_record_id',l.source_record_id,
    'raw_message_version_id',l.raw_message_version_id,'source_hash',l.source_hash,
    'source_candidate_hash',l.source_candidate_hash,'brand',l.brand_normalized,
    'reference_normalized',l.reference_normalized,'intent',upper(COALESCE(l.listing_type,l.intent,'')),
    'parent_id',l.parent_id,'is_bundle',l.is_bundle,
    'bundle_status',COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE'),
    'price_original',l.price_original,'currency_original',l.currency_original,
    'price_usd',l.price_usd,'currency_evidence',l.currency_evidence,
    'conversion_rate',l.conversion_rate,'conversion_timestamp',l.conversion_timestamp,
    'conversion_source',l.conversion_source,'source_created_on',rv.source_created_on,
    'price_research_status',l.price_research_status,
    'trading_floor_status',l.trading_floor_status,'verdict',l.verdict,
    'raw_message',rv.raw_text)
  FROM staging.listings l
  LEFT JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
    AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
  WHERE l.normalization_run_key=v_source_run_key AND l.brand_normalized=p_brand
    AND upper(COALESCE(l.listing_type,l.intent,''))='WTS' AND l.price_usd>0
    AND lower(COALESCE(l.price_research_status,''))<>'suppressed_exact_duplicate'
    AND (p_after_id IS NULL OR l.id>p_after_id)
  ORDER BY l.id LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_phase7b_verified_price_shadow_batch(
  p_run_key text, p_brand text, p_batch_number integer, p_batch_sha256 text, p_records jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, staging, price_research_shadow, extensions, pg_catalog
AS $function$
DECLARE r jsonb; l staging.listings%ROWTYPE; rv public.raw_message_versions%ROWTYPE;
  v_count integer := 0; v_existing text; v_span text; v_canonical text; v_hash text;
  v_first uuid; v_last uuid; v_batch_hash text;
BEGIN
  PERFORM 1 FROM price_research_shadow.runs WHERE run_key=p_run_key AND status='RUNNING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Phase 7B run is not running'; END IF;
  IF p_brand NOT IN ('Rolex','Patek Philippe') OR p_batch_number<1
    OR p_batch_sha256!~'^[0-9a-f]{64}$' OR jsonb_typeof(p_records)<>'array'
    OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid Phase 7B batch'; END IF;

  SELECT encode(extensions.digest(convert_to(string_agg(value->>'observation_sha256','' ORDER BY ordinality),'UTF8'),'sha256'),'hex')
    INTO v_batch_hash FROM jsonb_array_elements(p_records) WITH ORDINALITY;
  IF v_batch_hash IS DISTINCT FROM p_batch_sha256 THEN RAISE EXCEPTION 'Phase 7B batch digest mismatch'; END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    v_canonical := r->>'evidence_canonical';
    v_hash := encode(extensions.digest(convert_to(COALESCE(v_canonical,''),'UTF8'),'sha256'),'hex');
    IF v_canonical::jsonb IS DISTINCT FROM r-'source_span_text'-'evidence_canonical'-'observation_sha256'
      OR v_hash IS DISTINCT FROM r->>'observation_sha256' THEN RAISE EXCEPTION 'Observation digest mismatch'; END IF;
    SELECT * INTO l FROM staging.listings WHERE id=(r->>'listing_id')::uuid;
    SELECT * INTO rv FROM public.raw_message_versions WHERE id=NULLIF(r->>'raw_message_version_id','')::uuid;
    IF l.id IS NULL OR l.brand_normalized IS DISTINCT FROM p_brand
      OR l.source_record_id IS DISTINCT FROM r->>'source_record_id'
      OR l.raw_message_version_id IS DISTINCT FROM NULLIF(r->>'raw_message_version_id','')::uuid
      OR l.source_hash IS DISTINCT FROM r->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM NULLIF(r->>'source_candidate_hash','')
      OR upper(COALESCE(l.listing_type,l.intent,''))<>'WTS' OR l.price_usd<=0
      OR l.price_usd IS DISTINCT FROM (r->>'current_usd_amount')::numeric THEN
      RAISE EXCEPTION 'Immutable/source row drift for %',r->>'listing_id'; END IF;

    IF r->>'price_evidence_classification'<>'SOURCE_NOT_RECONCILABLE'
      AND (rv.id IS NULL OR rv.source_record_id IS DISTINCT FROM l.source_record_id
        OR rv.source_hash IS DISTINCT FROM l.source_hash) THEN
      RAISE EXCEPTION 'Immutable raw lineage is unavailable for classified row %',r->>'listing_id';
    END IF;

    IF r->>'price_evidence_classification'='VERIFIED_IN_NEW_COHORT' THEN
      SELECT canonical_model INTO v_existing FROM price_research_shadow.catalog_references
      WHERE run_key=p_run_key AND brand=p_brand AND canonical_reference=r->>'canonical_reference';
      IF v_existing IS NULL OR v_existing IS DISTINCT FROM r->>'canonical_model'
        OR r->>'parser_version'<>'price-parser-v5-shadow'
        OR NULLIF(r->>'source_span_text','') IS NULL THEN RAISE EXCEPTION 'Verified contract mismatch'; END IF;
      v_span := r->>'source_span_text';
      IF COALESCE((r->>'source_span_start')::integer,-1)<0
        OR COALESCE((r->>'source_span_end')::integer,0)<=(r->>'source_span_start')::integer
        OR substring(rv.raw_text FROM (r->>'source_span_start')::integer+1
          FOR (r->>'source_span_end')::integer-(r->>'source_span_start')::integer) IS DISTINCT FROM v_span
        OR encode(extensions.digest(convert_to(v_span,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r->>'source_span_sha256'
        OR abs((r->>'verified_usd_amount')::numeric-l.price_usd)>1.01 THEN
        RAISE EXCEPTION 'Verified source span/value mismatch'; END IF;
      IF upper(r->>'source_currency') IN ('USD','USDT') THEN
        IF abs((r->>'source_amount')::numeric-(r->>'verified_usd_amount')::numeric)>0.01 THEN
          RAISE EXCEPTION 'Direct USD/USDT mismatch'; END IF;
      ELSIF NULLIF(r->>'fx_provider','') IS NULL OR NULLIF(r->>'fx_effective_date','') IS NULL
        OR COALESCE((r->>'fx_rate')::numeric,0)<=0
        OR r->>'fx_contract'<>'wf-phase7b-ecb-historical-previous-published-day-v1'
        OR r->>'fx_provider'<>'European Central Bank reference rates'
        OR r->>'fx_rate_direction'<>'USD_PER_SOURCE_UNIT'
        OR r->>'fx_source_url'<>'https://data.ecb.europa.eu/data/datasets/EXR'
        OR NULLIF(r->>'fx_applicable_date','') IS NULL
        OR r->>'fx_applicable_date' IS DISTINCT FROM substring(rv.source_created_on FROM 1 FOR 10)
        OR (r->>'fx_effective_date')::date NOT BETWEEN (r->>'fx_applicable_date')::date-7
          AND (r->>'fx_applicable_date')::date
        OR abs(round((r->>'source_amount')::numeric*(r->>'fx_rate')::numeric)
          -(r->>'verified_usd_amount')::numeric)>1.01 THEN RAISE EXCEPTION 'Dated FX mismatch'; END IF;
    END IF;

    SELECT observation_sha256 INTO v_existing FROM price_research_shadow.observations
      WHERE run_key=p_run_key AND listing_id=(r->>'listing_id')::uuid;
    IF v_existing IS NOT NULL AND v_existing IS DISTINCT FROM r->>'observation_sha256' THEN
      RAISE EXCEPTION 'Non-idempotent observation replay'; END IF;
    INSERT INTO price_research_shadow.observations(run_key,listing_id,source_record_id,
      raw_message_version_id,source_hash,source_candidate_hash,brand,canonical_model,canonical_reference,
      intent,source_amount,source_currency,parser_version,parser_rule,source_span_start,source_span_end,
      source_span_sha256,price_evidence_classification,fx_provider,fx_rate,fx_effective_date,
      fx_applicable_date,fx_contract,fx_rate_direction,fx_source_url,stored_fx_comparison,
      verified_usd_amount,current_usd_amount,qualification_reason,exclusion_reason,dedupe_status,observation_sha256)
    VALUES(p_run_key,(r->>'listing_id')::uuid,NULLIF(r->>'source_record_id',''),NULLIF(r->>'raw_message_version_id','')::uuid,
      NULLIF(r->>'source_hash',''),NULLIF(r->>'source_candidate_hash',''),p_brand,NULLIF(r->>'canonical_model',''),
      NULLIF(r->>'canonical_reference',''),'WTS',NULLIF(r->>'source_amount','')::numeric,
      NULLIF(r->>'source_currency',''),r->>'parser_version',NULLIF(r->>'parser_rule',''),
      NULLIF(r->>'source_span_start','')::integer,NULLIF(r->>'source_span_end','')::integer,
      NULLIF(r->>'source_span_sha256',''),r->>'price_evidence_classification',NULLIF(r->>'fx_provider',''),
      NULLIF(r->>'fx_rate','')::numeric,NULLIF(r->>'fx_effective_date','')::date,
      NULLIF(r->>'fx_applicable_date','')::date,NULLIF(r->>'fx_contract',''),NULLIF(r->>'fx_rate_direction',''),
      NULLIF(r->>'fx_source_url',''),r->'stored_fx_comparison',
      NULLIF(r->>'verified_usd_amount','')::numeric,(r->>'current_usd_amount')::numeric,
      NULLIF(r->>'qualification_reason',''),NULLIF(r->>'exclusion_reason',''),r->>'dedupe_status',
      r->>'observation_sha256') ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
    v_first:=COALESCE(v_first,(r->>'listing_id')::uuid); v_last:=(r->>'listing_id')::uuid;
  END LOOP;
  INSERT INTO price_research_shadow.checkpoints(run_key,brand,batch_number,first_listing_id,
    last_listing_id,input_rows,inserted_rows,batch_sha256)
  VALUES(p_run_key,p_brand,p_batch_number,v_first,v_last,v_count,v_count,p_batch_sha256)
  ON CONFLICT (run_key,brand,batch_number) DO NOTHING;
  UPDATE price_research_shadow.runs SET processed_observation_count=(SELECT count(*) FROM price_research_shadow.observations WHERE run_key=p_run_key),
    verified_observation_count=(SELECT count(*) FROM price_research_shadow.observations WHERE run_key=p_run_key AND price_evidence_classification='VERIFIED_IN_NEW_COHORT'),updated_at=now()
  WHERE run_key=p_run_key;
  RETURN jsonb_build_object('processed',v_count,'last_listing_id',v_last);
END;
$function$;


CREATE OR REPLACE FUNCTION public.phase7b_verified_shadow_report(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,price_research_shadow,pg_catalog
AS $function$
DECLARE v_report jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM price_research_shadow.runs WHERE run_key=p_run_key AND status='COMPLETE') THEN
    RAISE EXCEPTION 'Phase 7B report requires a complete run'; END IF;
  SELECT jsonb_build_object(
    'run',(SELECT to_jsonb(r)-'project_ref' FROM price_research_shadow.runs r WHERE run_key=p_run_key),
    'brand_summary',(SELECT jsonb_agg(x ORDER BY brand) FROM (
      SELECT brand,count(*) FILTER(WHERE price_evidence_classification='VERIFIED_IN_NEW_COHORT') verified_observations,
        count(*) total_legacy_pr_observations,
        count(DISTINCT canonical_reference) FILTER(WHERE canonical_reference IS NOT NULL) customer_safe_references,
        count(*)-count(*) FILTER(WHERE price_evidence_classification='VERIFIED_IN_NEW_COHORT') excluded_or_review
      FROM price_research_shadow.observations WHERE run_key=p_run_key GROUP BY brand) x),
    'classification_counts',(SELECT jsonb_agg(x ORDER BY brand,price_evidence_classification) FROM (
      SELECT brand,price_evidence_classification,count(*) count
      FROM price_research_shadow.observations WHERE run_key=p_run_key GROUP BY brand,price_evidence_classification) x),
    'reference_census',(SELECT jsonb_agg(to_jsonb(c)-'run_key' ORDER BY brand,canonical_reference)
      FROM price_research_shadow.reference_census c WHERE run_key=p_run_key),
    'rating_impact',(SELECT jsonb_agg(x ORDER BY brand,impact_class) FROM (
      SELECT brand,impact_class,count(*) count FROM price_research_shadow.price_rating_impact
      WHERE run_key=p_run_key GROUP BY brand,impact_class) x),
    'extreme_evidence',(SELECT jsonb_agg(x ORDER BY brand,canonical_reference,current_usd_amount DESC) FROM (
      WITH bounds AS (
        SELECT brand,canonical_reference,
          percentile_cont(.25) WITHIN GROUP(ORDER BY current_usd_amount) q1,
          percentile_cont(.75) WITHIN GROUP(ORDER BY current_usd_amount) q3
        FROM price_research_shadow.observations
        WHERE run_key=p_run_key AND canonical_reference IS NOT NULL
        GROUP BY brand,canonical_reference
      )
      SELECT o.listing_id,o.brand,o.canonical_reference,o.source_amount,o.source_currency,
        o.current_usd_amount,o.verified_usd_amount,o.price_evidence_classification,
        CASE WHEN o.current_usd_amount<b.q1-3.0*(b.q3-b.q1) THEN 'LOW' ELSE 'HIGH' END outlier_direction,
        CASE
          WHEN o.price_evidence_classification='VERIFIED_IN_NEW_COHORT' THEN 'SOURCE_EXPLICIT_VALID'
          WHEN o.price_evidence_classification IN ('LEGACY_USD_DEFAULTED','BARE_DOLLAR_AMBIGUOUS',
            'CURRENCYLESS_AMOUNT','CURRENCYLESS_KM') THEN 'CURRENCY_ERROR'
          WHEN o.price_evidence_classification IN ('FX_PROVENANCE_MISSING','FX_INVALID') THEN 'FX_ERROR'
          WHEN o.price_evidence_classification IN ('REFERENCE_INVALID','REFERENCE_AMBIGUOUS') THEN 'REFERENCE_ASSOCIATION_ERROR'
          WHEN o.price_evidence_classification='OTHER' THEN 'PARSER_ERROR'
          ELSE 'REVIEW_REQUIRED' END extreme_classification
      FROM price_research_shadow.observations o JOIN bounds b USING(brand,canonical_reference)
      WHERE o.run_key=p_run_key AND (o.current_usd_amount<b.q1-3.0*(b.q3-b.q1)
        OR o.current_usd_amount>b.q3+3.0*(b.q3-b.q1))
      ORDER BY o.current_usd_amount DESC LIMIT 100) x),
    'proposed_canaries',(SELECT jsonb_agg(x ORDER BY brand,impact_rank) FROM (
      SELECT *,row_number() OVER(PARTITION BY brand ORDER BY median_delta_ratio DESC NULLS LAST,
        current_observation_count DESC,canonical_reference) impact_rank FROM (
        SELECT brand,canonical_reference,current_observation_count,verified_observation_count,
          current_median,verified_median,
          abs(verified_median/NULLIF(current_median,0)-1) median_delta_ratio
        FROM price_research_shadow.reference_census WHERE run_key=p_run_key
          AND current_analytics_ready AND verified_analytics_ready) ranked) x WHERE impact_rank<=5)
  ) INTO v_report;
  RETURN v_report;
END;
$function$;

CREATE OR REPLACE FUNCTION public.phase7b_verified_reference_snapshot(
  p_run_key text,p_brand text,p_reference text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,price_research_shadow,pg_catalog
AS $function$
  SELECT to_jsonb(c) FROM price_research_shadow.reference_census c
  WHERE c.run_key=p_run_key AND c.brand=p_brand AND c.canonical_reference=p_reference
    AND EXISTS(SELECT 1 FROM price_research_shadow.runs r WHERE r.run_key=c.run_key AND r.status='COMPLETE');
$function$;

-- Bounded implementation. Every exact reference is materialized separately
-- with a 45-second statement timeout before the lightweight closeout runs.
CREATE OR REPLACE FUNCTION price_research_shadow.price_stats(p_values numeric[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path=price_research_shadow,pg_catalog
AS $function$
DECLARE v_raw bigint;v_q1 numeric;v_q3 numeric;v_low numeric;v_high numeric;
  v_clean bigint;v_median numeric;v_mean numeric;v_min numeric;v_max numeric;
BEGIN
  SELECT count(*),percentile_cont(.25) WITHIN GROUP(ORDER BY value),
    percentile_cont(.75) WITHIN GROUP(ORDER BY value)
  INTO v_raw,v_q1,v_q3 FROM unnest(COALESCE(p_values,ARRAY[]::numeric[])) value WHERE value>0;
  IF v_raw=0 THEN RETURN jsonb_build_object('raw_count',0,'clean_count',0,'ready',false); END IF;
  v_low:=v_q1-3.0*(v_q3-v_q1);v_high:=v_q3+3.0*(v_q3-v_q1);
  SELECT count(*),percentile_cont(.5) WITHIN GROUP(ORDER BY value),avg(value),min(value),max(value)
  INTO v_clean,v_median,v_mean,v_min,v_max
  FROM unnest(p_values) value WHERE value>0 AND value BETWEEN v_low AND v_high;
  RETURN jsonb_build_object('raw_count',v_raw,'clean_count',v_clean,'ready',v_clean>=2,
    'median',v_median,'mean',v_mean,'min',v_min,'max',v_max,'q1',v_q1,'q3',v_q3,
    'lower_fence',v_low,'upper_fence',v_high,'iqr_multiplier',3.0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_phase7b_verified_reference(
  p_run_key text,p_brand text,p_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,price_research_shadow,extensions,pg_catalog
SET statement_timeout='45s'
AS $function$
DECLARE v_source_run_key text;v_model text;v_current jsonb;v_verified jsonb;v_result jsonb;
  v_total bigint;v_wts bigint;v_wtb bigint;v_priced bigint;v_images bigint;
  v_legacy bigint;v_verified_n bigint;v_review bigint;v_excluded bigint;
BEGIN
  SELECT r.source_run_key,c.canonical_model INTO v_source_run_key,v_model
  FROM price_research_shadow.runs r JOIN price_research_shadow.catalog_references c ON c.run_key=r.run_key
  WHERE r.run_key=p_run_key AND r.status='RUNNING' AND c.brand=p_brand AND c.canonical_reference=p_reference;
  IF v_source_run_key IS NULL THEN RAISE EXCEPTION 'Reference is absent or run is not running'; END IF;

  SELECT price_research_shadow.price_stats(array_agg(current_usd_amount ORDER BY listing_id)),
    price_research_shadow.price_stats(array_agg(verified_usd_amount ORDER BY listing_id)
      FILTER(WHERE price_evidence_classification='VERIFIED_IN_NEW_COHORT')),
    count(*),count(*) FILTER(WHERE price_evidence_classification='VERIFIED_IN_NEW_COHORT'),
    count(*) FILTER(WHERE price_evidence_classification IN
      ('LEGACY_USD_DEFAULTED','BARE_DOLLAR_AMBIGUOUS','CURRENCYLESS_AMOUNT','CURRENCYLESS_KM',
       'FX_PROVENANCE_MISSING','FX_INVALID','MULTIPLE_PRICE_AMBIGUOUS','BUNDLE_PRICE_AMBIGUOUS',
       'SOURCE_PRICE_CONFLICT','REFERENCE_AMBIGUOUS','REVIEW_REQUIRED')),
    count(*) FILTER(WHERE price_evidence_classification IN
      ('REFERENCE_INVALID','SOURCE_NOT_RECONCILABLE','OTHER'))
  INTO v_current,v_verified,v_legacy,v_verified_n,v_review,v_excluded
  FROM price_research_shadow.observations WHERE run_key=p_run_key AND brand=p_brand
    AND canonical_reference=p_reference;

  SELECT count(DISTINCT l.id),
    count(DISTINCT l.id) FILTER(WHERE upper(COALESCE(l.listing_type,l.intent,''))='WTS'),
    count(DISTINCT l.id) FILTER(WHERE upper(COALESCE(l.listing_type,l.intent,''))='WTB'),
    count(DISTINCT l.id) FILTER(WHERE COALESCE(l.price_usd,l.price_normalized,0)>0),
    count(DISTINCT l.id) FILTER(WHERE btrim(COALESCE(l.image_url,l.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$')
  INTO v_total,v_wts,v_wtb,v_priced,v_images FROM staging.listings l
  WHERE l.normalization_run_key=v_source_run_key AND l.brand_normalized=p_brand
    AND l.reference_normalized=p_reference AND upper(COALESCE(l.category,''))='WATCH'
    AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
    AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
    AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id,'')<>''
    AND l.source_hash~'^[0-9a-f]{64}$' AND l.source_candidate_hash~'^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN
      ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
       'superseded','suppressed','duplicate','withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED');

  v_result:=jsonb_build_object('brand',p_brand,'canonical_model',v_model,'canonical_reference',p_reference,
    'publication_contract','QNSA_GENERAL_MARKET_FEED_V1_SINGLE_WATCH_WTS_WTB',
    'total_published_listings',v_total,'wts_listings',v_wts,'wtb_listings',v_wtb,
    'priced_listings',v_priced,'image_linked_listings',v_images,
    'legacy_pr_observations',v_legacy,'verified_pr_observations',v_verified_n,
    'review_required_observations',v_review,'excluded_observations',v_excluded,
    'current',v_current,'verified',v_verified);
  INSERT INTO price_research_shadow.reference_census(run_key,brand,canonical_model,canonical_reference,
    publication_contract,total_published_listings,wts_listings,wtb_listings,priced_listings,image_linked_listings,
    legacy_pr_observations,verified_pr_observations,review_required_observations,excluded_observations,
    current_observation_count,current_qualified_comparable_count,current_median,current_mean,current_min,current_max,
    current_analytics_ready,verified_observation_count,verified_qualified_comparable_count,verified_median,
    verified_mean,verified_min,verified_max,verified_analytics_ready,census_sha256)
  VALUES(p_run_key,p_brand,v_model,p_reference,'QNSA_GENERAL_MARKET_FEED_V1_SINGLE_WATCH_WTS_WTB',
    v_total,v_wts,v_wtb,v_priced,v_images,v_legacy,v_verified_n,v_review,v_excluded,
    COALESCE((v_current->>'raw_count')::bigint,0),COALESCE((v_current->>'clean_count')::bigint,0),
    (v_current->>'median')::numeric,(v_current->>'mean')::numeric,(v_current->>'min')::numeric,(v_current->>'max')::numeric,
    COALESCE((v_current->>'ready')::boolean,false),COALESCE((v_verified->>'raw_count')::bigint,0),
    COALESCE((v_verified->>'clean_count')::bigint,0),(v_verified->>'median')::numeric,(v_verified->>'mean')::numeric,
    (v_verified->>'min')::numeric,(v_verified->>'max')::numeric,COALESCE((v_verified->>'ready')::boolean,false),
    encode(extensions.digest(convert_to(v_result::text,'UTF8'),'sha256'),'hex'))
  ON CONFLICT(run_key,brand,canonical_reference) DO UPDATE SET
    total_published_listings=EXCLUDED.total_published_listings,wts_listings=EXCLUDED.wts_listings,
    wtb_listings=EXCLUDED.wtb_listings,priced_listings=EXCLUDED.priced_listings,
    image_linked_listings=EXCLUDED.image_linked_listings,legacy_pr_observations=EXCLUDED.legacy_pr_observations,
    verified_pr_observations=EXCLUDED.verified_pr_observations,
    review_required_observations=EXCLUDED.review_required_observations,excluded_observations=EXCLUDED.excluded_observations,
    current_observation_count=EXCLUDED.current_observation_count,
    current_qualified_comparable_count=EXCLUDED.current_qualified_comparable_count,current_median=EXCLUDED.current_median,
    current_mean=EXCLUDED.current_mean,current_min=EXCLUDED.current_min,current_max=EXCLUDED.current_max,
    current_analytics_ready=EXCLUDED.current_analytics_ready,verified_observation_count=EXCLUDED.verified_observation_count,
    verified_qualified_comparable_count=EXCLUDED.verified_qualified_comparable_count,
    verified_median=EXCLUDED.verified_median,verified_mean=EXCLUDED.verified_mean,verified_min=EXCLUDED.verified_min,
    verified_max=EXCLUDED.verified_max,verified_analytics_ready=EXCLUDED.verified_analytics_ready,
    census_sha256=EXCLUDED.census_sha256;

  DELETE FROM price_research_shadow.price_rating_impact
  WHERE run_key=p_run_key AND brand=p_brand AND canonical_reference=p_reference;
  WITH benchmark_arrays AS (
    SELECT lower(COALESCE(l.dial_color_normalized,'unspecified')) dial_key,
      array_agg(o.current_usd_amount ORDER BY o.listing_id) current_values,
      array_agg(o.verified_usd_amount ORDER BY o.listing_id)
        FILTER(WHERE o.price_evidence_classification='VERIFIED_IN_NEW_COHORT') verified_values,
      bool_or(o.price_evidence_classification<>'VERIFIED_IN_NEW_COHORT') has_untrusted
    FROM price_research_shadow.observations o JOIN staging.listings l ON l.id=o.listing_id
    WHERE o.run_key=p_run_key AND o.brand=p_brand AND o.canonical_reference=p_reference
    GROUP BY lower(COALESCE(l.dial_color_normalized,'unspecified'))
  ), benchmarks AS (
    SELECT dial_key,price_research_shadow.price_stats(current_values) current_stats,
      price_research_shadow.price_stats(verified_values) verified_stats,has_untrusted
    FROM benchmark_arrays
  ), published AS (
    SELECT l.id listing_id,l.price_usd listing_price_usd,
      lower(COALESCE(l.dial_color_normalized,'unspecified')) dial_key
    FROM staging.listings l
    WHERE l.normalization_run_key=v_source_run_key AND l.brand_normalized=p_brand
      AND l.reference_normalized=p_reference AND COALESCE(l.price_usd,0)>0
      AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN
        ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
         'superseded','suppressed','duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  ), rated AS (
    SELECT p.*,b.current_stats,b.verified_stats,COALESCE(b.has_untrusted,false) has_untrusted,
      CASE WHEN COALESCE((b.current_stats->>'clean_count')::bigint,0)<2
          OR p.listing_price_usd NOT BETWEEN (b.current_stats->>'min')::numeric AND (b.current_stats->>'max')::numeric THEN 'NOT_RATED'
        WHEN p.listing_price_usd<=(b.current_stats->>'median')::numeric*.95 THEN 'GOOD'
        WHEN p.listing_price_usd<=(b.current_stats->>'median')::numeric*1.05 THEN 'MARKET' ELSE 'HIGH' END current_rating,
      CASE WHEN COALESCE((b.verified_stats->>'clean_count')::bigint,0)<2
          OR p.listing_price_usd NOT BETWEEN (b.verified_stats->>'min')::numeric AND (b.verified_stats->>'max')::numeric THEN 'NOT_RATED'
        WHEN p.listing_price_usd<=(b.verified_stats->>'median')::numeric*.95 THEN 'GOOD'
        WHEN p.listing_price_usd<=(b.verified_stats->>'median')::numeric*1.05 THEN 'MARKET' ELSE 'HIGH' END verified_rating
    FROM published p LEFT JOIN benchmarks b USING(dial_key)
  ), result AS (
    SELECT r.*,
      CASE WHEN current_rating<>'NOT_RATED' AND verified_rating='NOT_RATED' THEN 'OPEN_FOR_RATING'
        WHEN current_rating<>verified_rating THEN 'CHANGED'
        WHEN has_untrusted AND current_rating<>'NOT_RATED' THEN 'CURRENTLY_RATED_FROM_UNTRUSTED_BENCHMARK'
        ELSE 'UNCHANGED' END impact_class FROM rated r
  )
  INSERT INTO price_research_shadow.price_rating_impact(run_key,listing_id,brand,canonical_reference,dial_key,
    listing_price_usd,current_comparable_count,verified_comparable_count,current_rating,verified_rating,
    impact_class,impact_sha256)
  SELECT p_run_key,listing_id,p_brand,p_reference,dial_key,listing_price_usd,
    COALESCE((current_stats->>'clean_count')::bigint,0),COALESCE((verified_stats->>'clean_count')::bigint,0),
    current_rating,verified_rating,impact_class,
    encode(extensions.digest(convert_to(jsonb_build_object('listing_id',listing_id,'current_rating',current_rating,
      'verified_rating',verified_rating,'impact_class',impact_class)::text,'UTF8'),'sha256'),'hex') FROM result;
  RETURN v_result||jsonb_build_object('census_sha256',encode(extensions.digest(convert_to(v_result::text,'UTF8'),'sha256'),'hex'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_phase7b_verified_price_shadow(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,price_research_shadow,extensions,pg_catalog
AS $function$
DECLARE v_expected bigint;v_actual bigint;v_catalog bigint;v_census bigint;v_sha text;v_verified bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('phase7b_verified_price_shadow'));
  SELECT source_observation_count INTO v_expected FROM price_research_shadow.runs
    WHERE run_key=p_run_key AND status='RUNNING' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Phase 7B run is not running'; END IF;
  SELECT count(*),count(*) FILTER(WHERE price_evidence_classification='VERIFIED_IN_NEW_COHORT')
    INTO v_actual,v_verified FROM price_research_shadow.observations WHERE run_key=p_run_key;
  SELECT count(*) INTO v_catalog FROM price_research_shadow.catalog_references WHERE run_key=p_run_key;
  SELECT count(*) INTO v_census FROM price_research_shadow.reference_census WHERE run_key=p_run_key;
  IF v_actual<>v_expected OR v_census<>v_catalog THEN
    RAISE EXCEPTION 'Incomplete Phase 7B closeout observations %/% references %/%',v_actual,v_expected,v_census,v_catalog;
  END IF;
  SELECT encode(extensions.digest(convert_to(string_agg(census_sha256,'' ORDER BY brand,canonical_reference),'UTF8'),'sha256'),'hex')
    INTO v_sha FROM price_research_shadow.reference_census WHERE run_key=p_run_key;
  UPDATE price_research_shadow.runs SET status='COMPLETE',processed_observation_count=v_actual,
    verified_observation_count=v_verified,result_sha256=v_sha,updated_at=now(),completed_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'status','COMPLETE','observations',v_actual,
    'verified',v_verified,'references',v_census,'result_sha256',v_sha);
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_phase7b_verified_price_shadow(text,text,text,text,jsonb),
  public.phase7b_verified_price_source_page(text,text,uuid,integer),
  public.ingest_phase7b_verified_price_shadow_batch(text,text,integer,text,jsonb),
  public.complete_phase7b_verified_price_shadow(text),
  public.materialize_phase7b_verified_reference(text,text,text),
  public.phase7b_verified_reference_snapshot(text,text,text),
  public.phase7b_verified_shadow_report(text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION price_research_shadow.price_stats(numeric[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_phase7b_verified_price_shadow(text,text,text,text,jsonb),
  public.phase7b_verified_price_source_page(text,text,uuid,integer),
  public.ingest_phase7b_verified_price_shadow_batch(text,text,integer,text,jsonb),
  public.complete_phase7b_verified_price_shadow(text),
  public.materialize_phase7b_verified_reference(text,text,text),
  public.phase7b_verified_reference_snapshot(text,text,text),
  public.phase7b_verified_shadow_report(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION price_research_shadow.price_stats(numeric[]) TO service_role;

COMMENT ON SCHEMA price_research_shadow IS
  'Private Phase 7B derived analytics. Not connected to customer endpoints or views.';

COMMIT;
