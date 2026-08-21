-- Missing-field enrichment for Tudor, Omega, Cartier and Zenith only.
-- Immutable staging/raw rows are never updated. Customer APIs consume the
-- active sidecar through qnsa_four_brand_effective_page_rows.

BEGIN;

-- Signature checksum source:
-- qnsa-four-brand-enrichment-v2|validate(jsonb)|begin(text,text,text,integer,uuid[],text)|stage(text,jsonb)|finalize(text)|fail(text)|activate(text)|rollback(text)|effective-enrichments(uuid[])|effective-page(text,integer,integer,text,text,text,text,text,text,text[],boolean,boolean,timestamptz,text,text)
-- A prior unversioned installation of any sidecar object is not safe to
-- upgrade with CREATE ... IF NOT EXISTS. Require the complete, exact contract
-- marker or a completely absent installation.
DO $$
DECLARE
  v_core_count integer;
  v_marker_exists boolean;
  v_version text;
  v_signature text;
BEGIN
  SELECT count(*) INTO v_core_count FROM unnest(ARRAY[
    to_regclass('public.qnsa_four_brand_enrichment_runs'),
    to_regclass('public.qnsa_four_brand_enrichment_proposals'),
    to_regclass('public.qnsa_four_brand_enrichment_control'),
    to_regclass('public.qnsa_four_brand_enrichment_rollback_ledger')
  ]) AS t(rel) WHERE rel IS NOT NULL;
  v_marker_exists := to_regclass('public.qnsa_four_brand_enrichment_schema_contract') IS NOT NULL;
  IF v_core_count > 0 AND NOT v_marker_exists THEN
    RAISE EXCEPTION 'Unversioned four-brand enrichment schema exists; refusing incompatible install';
  END IF;
  IF v_marker_exists THEN
    EXECUTE 'SELECT contract_version,signature_sha256 FROM public.qnsa_four_brand_enrichment_schema_contract WHERE singleton=true'
      INTO v_version,v_signature;
    IF v_core_count <> 4 OR v_version IS DISTINCT FROM '2026-08-20-v2'
      OR v_signature IS DISTINCT FROM 'd67cb39107e7446de3d8d26be20058a3f7f5dce932f7feb92a56d4ac742406b2' THEN
      RAISE EXCEPTION 'Four-brand enrichment schema contract is absent or incompatible';
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_schema_contract (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version text NOT NULL,
  signature_sha256 text NOT NULL CHECK (signature_sha256 ~ '^[0-9a-f]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.qnsa_four_brand_enrichment_schema_contract(
  singleton,contract_version,signature_sha256
) VALUES (
  true,'2026-08-20-v2','d67cb39107e7446de3d8d26be20058a3f7f5dce932f7feb92a56d4ac742406b2'
) ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_runs (
  run_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('AUDIT','CANARY','FULL')),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  expected_count integer NOT NULL CHECK (expected_count BETWEEN 1 AND 50000),
  canary_listing_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  canary_plan_sha256 text CHECK (canary_plan_sha256 IS NULL OR canary_plan_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'STAGING' CHECK (status IN (
    'STAGING','STAGED','CANARY_ACTIVE','FULL_ACTIVE','ROLLED_BACK','FAILED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_proposals (
  run_key text NOT NULL REFERENCES public.qnsa_four_brand_enrichment_runs(run_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL,
  canonical_brand text NOT NULL CHECK (canonical_brand IN ('Tudor','Omega','Cartier','Zenith')),
  raw_message_version_id uuid NOT NULL,
  source_record_id text NOT NULL CHECK (btrim(source_record_id) <> ''),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_candidate_hash text NOT NULL CHECK (source_candidate_hash ~ '^[0-9a-f]{64}$'),
  proposed_model text,
  proposed_reference text,
  proposed_dial_color text,
  proposed_condition text,
  proposed_price_usd numeric,
  price_evidence_status text CHECK (price_evidence_status IS NULL OR price_evidence_status IN (
    'SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX','OWNER_ASSUMED_USD'
  )),
  source_price_amount numeric,
  source_currency text,
  fx_rate numeric,
  fx_source text,
  fx_date date,
  evidence jsonb NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  generator_version text NOT NULL CHECK (generator_version = 'four-brand-private-manifest-v1'),
  proposal_authority jsonb NOT NULL,
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[0-9a-f]{64}$'),
  staged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, listing_id),
  CHECK (num_nonnulls(proposed_model, proposed_reference, proposed_dial_color,
    proposed_condition, proposed_price_usd) > 0),
  CHECK (proposed_price_usd IS NULL OR (proposed_price_usd > 0 AND price_evidence_status IS NOT NULL)),
  CHECK (price_evidence_status <> 'DATED_VERIFIED_FX' OR (
    source_price_amount > 0 AND NULLIF(btrim(source_currency), '') IS NOT NULL
    AND fx_rate > 0 AND NULLIF(btrim(fx_source), '') IS NOT NULL AND fx_date IS NOT NULL
  ))
);

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_run_key text REFERENCES public.qnsa_four_brand_enrichment_runs(run_key),
  enabled_mode text CHECK (enabled_mode IS NULL OR enabled_mode IN ('CANARY','FULL')),
  enabled_listing_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  plan_sha256 text CHECK (plan_sha256 IS NULL OR plan_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((enabled_run_key IS NULL AND enabled_mode IS NULL AND cardinality(enabled_listing_ids)=0)
    OR (enabled_run_key IS NOT NULL AND enabled_mode IS NOT NULL))
);

INSERT INTO public.qnsa_four_brand_enrichment_control(singleton) VALUES(true)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_rollback_ledger (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_key text NOT NULL REFERENCES public.qnsa_four_brand_enrichment_runs(run_key),
  action text NOT NULL CHECK (action IN ('CONTROL_SWITCH','ROLLBACK')),
  prior_control jsonb NOT NULL,
  next_control jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL DEFAULT current_user
);

CREATE INDEX IF NOT EXISTS idx_qnsa_four_brand_enrichment_run
  ON public.qnsa_four_brand_enrichment_proposals(run_key, listing_id);
CREATE INDEX IF NOT EXISTS idx_qnsa_four_brand_enrichment_effective_reference
  ON public.qnsa_four_brand_enrichment_proposals(
    canonical_brand, (regexp_replace(upper(COALESCE(proposed_reference,'')), '[^A-Z0-9]', '', 'g'))
  );
CREATE INDEX IF NOT EXISTS idx_qnsa_four_brand_enrichment_effective_model
  ON public.qnsa_four_brand_enrichment_proposals(canonical_brand, proposed_model);

ALTER TABLE public.qnsa_four_brand_enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_enrichment_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_enrichment_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_enrichment_rollback_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_enrichment_schema_contract ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qnsa_four_brand_enrichment_runs,
  public.qnsa_four_brand_enrichment_proposals,
  public.qnsa_four_brand_enrichment_control,
  public.qnsa_four_brand_enrichment_rollback_ledger,
  public.qnsa_four_brand_enrichment_schema_contract FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qnsa_four_brand_enrichment_runs,
  public.qnsa_four_brand_enrichment_proposals,
  public.qnsa_four_brand_enrichment_control,
  public.qnsa_four_brand_enrichment_rollback_ledger TO service_role;
GRANT SELECT ON public.qnsa_four_brand_enrichment_schema_contract TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.qnsa_four_brand_value_missing(p_field text, p_value text, p_brand text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(btrim(COALESCE(p_value,'')), '') IS NULL
    OR lower(btrim(COALESCE(p_value,''))) IN (
      'unknown','unspecified','not specified','not provided','reference only',
      'model not specified','dial not specified','condition not specified',lower(btrim(COALESCE(p_brand,'')))
    );
$$;

-- Private producer input. Raw text and authority hashes are service-only and
-- never returned by customer APIs or accepted from a public crawl as truth.
CREATE OR REPLACE FUNCTION public.qnsa_four_brand_private_enrichment_candidates(p_listing_ids uuid[])
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
  SELECT jsonb_build_object(
    'listing_id',l.id::text,'canonical_brand',l.brand_normalized,
    'raw_message_version_id',l.raw_message_version_id::text,
    'source_record_id',l.source_record_id,'source_hash',l.source_hash,
    'source_candidate_hash',l.source_candidate_hash,'raw_message',l.raw_message_text,
    'listing_type',upper(COALESCE(l.listing_type,l.intent,'')),
    'model',l.model_normalized,'reference',l.reference_normalized,
    'dial_color',l.dial_color_normalized,'condition',l.condition_normalized,
    'price_usd',l.price_usd,'price_normalized',l.price_normalized,
    'currency',l.currency_normalized,'source_price_amount',l.price_original,
    'source_currency',COALESCE(l.currency_original,l.currency_normalized),
    'fx_rate',l.conversion_rate,'fx_source',l.conversion_source,
    'fx_date',l.conversion_timestamp::date
  ) FROM staging.listings l JOIN public.raw_message_versions rv
    ON rv.id=l.raw_message_version_id AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
  WHERE l.id=ANY(COALESCE(p_listing_ids,'{}'::uuid[]))
    AND cardinality(COALESCE(p_listing_ids,'{}'::uuid[])) BETWEEN 1 AND 500
    AND l.brand_normalized IN ('Tudor','Omega','Cartier','Zenith')
    AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
    AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB');
$$;

-- Service-only, read-only validation used by AUDIT and by the staging gate.
-- This function intentionally performs no proposal, run, or control writes.
CREATE OR REPLACE FUNCTION public.validate_qnsa_four_brand_enrichment_records(p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,staging,extensions,pg_catalog AS $$
DECLARE
  r jsonb; a jsonb; b jsonb; l staging.listings%ROWTYPE; v_count integer := 0;
  v_evidence jsonb; v_proposal_digest text; v_proposal_canonical text;
  v_field text; v_quote text;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Each validation call requires 1..500 records';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    a := r->'proposal_authority';
    IF jsonb_typeof(a) <> 'object' OR a->>'generator_version' <> 'four-brand-private-manifest-v1' THEN
      RAISE EXCEPTION 'Trusted private proposal authority is required';
    END IF;
    v_proposal_canonical := r->>'proposal_canonical';
    IF NULLIF(v_proposal_canonical,'') IS NULL OR v_proposal_canonical::jsonb IS DISTINCT FROM a THEN
      RAISE EXCEPTION 'Trusted proposal canonical payload mismatch';
    END IF;
    v_proposal_digest := encode(extensions.digest(convert_to(v_proposal_canonical,'UTF8'),'sha256'),'hex');
    IF v_proposal_digest IS DISTINCT FROM r->>'proposal_digest' THEN
      RAISE EXCEPTION 'Trusted proposal digest mismatch';
    END IF;
    SELECT * INTO l FROM staging.listings WHERE id=(a->>'listing_id')::uuid;
    IF NOT FOUND OR l.brand_normalized NOT IN ('Tudor','Omega','Cartier','Zenith')
      OR l.brand_normalized <> a->>'canonical_brand'
      OR l.raw_message_version_id IS DISTINCT FROM (a->>'raw_message_version_id')::uuid
      OR l.source_record_id IS DISTINCT FROM a->>'source_record_id'
      OR l.source_hash IS DISTINCT FROM a->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM a->>'source_candidate_hash'
      OR NOT EXISTS (SELECT 1 FROM public.raw_message_versions rv
        WHERE rv.id=l.raw_message_version_id AND rv.source_record_id=l.source_record_id
          AND rv.source_hash=l.source_hash) THEN
      RAISE EXCEPTION 'Private exact lineage mismatch for listing %',a->>'listing_id';
    END IF;
    IF l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
      OR upper(COALESCE(l.listing_type,l.intent,'')) NOT IN ('WTS','WTB') THEN
      RAISE EXCEPTION 'Only released individual WTS/WTB watches may be enriched';
    END IF;

    v_evidence := COALESCE(a->'evidence','{}'::jsonb);
    IF a ? 'proposed_model' AND NOT public.qnsa_four_brand_value_missing('model',l.model_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Model is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_reference' AND NULLIF(btrim(COALESCE(l.reference_normalized,'')),'') IS NOT NULL
      THEN RAISE EXCEPTION 'Reference is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_dial_color' AND NOT public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Dial is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_condition' AND NOT public.qnsa_four_brand_value_missing('condition',l.condition_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Condition is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_price_usd' AND (COALESCE(l.price_usd,0)>0 OR COALESCE(l.price_normalized,0)>0)
      THEN RAISE EXCEPTION 'Price is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_price_usd' AND upper(COALESCE(l.listing_type,l.intent,'')) <> 'WTS'
      THEN RAISE EXCEPTION 'Price enrichment is WTS-only'; END IF;
    IF a ? 'proposed_image_url' OR a ? 'dealer_id' OR a ? 'dealer_rating' THEN
      RAISE EXCEPTION 'Images and dealers require their exact dedicated ledgers';
    END IF;

    FOREACH v_field IN ARRAY ARRAY['model','reference','dial_color','condition','price_usd'] LOOP
      IF a ? ('proposed_'||v_field) THEN
        b := a->'field_bindings'->v_field;
        v_quote := v_evidence->>(CASE WHEN v_field='dial_color' THEN 'dial_quote' ELSE v_field||'_quote' END);
        IF jsonb_typeof(b) <> 'object' OR NULLIF(v_quote,'') IS NULL
          OR strpos(COALESCE(l.raw_message_text,''),v_quote)=0
          OR b->>'quote_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(v_quote,'UTF8'),'sha256'),'hex')
          OR b->>'normalized_value' IS DISTINCT FROM a->>('proposed_'||v_field) THEN
          RAISE EXCEPTION 'Field binding mismatch for % on listing %',v_field,l.id;
        END IF;
      END IF;
    END LOOP;
    IF a ? 'proposed_reference' AND (
      COALESCE((a->>'catalog_reference_confirmed')::boolean,false)=false
      OR a->'field_bindings'->'reference'->>'rule' <> 'EXACT_RAW_REFERENCE_CATALOG_CONFIRMED') THEN
      RAISE EXCEPTION 'New references require exact raw and catalog confirmation';
    END IF;
    IF (a ? 'proposed_model' AND a->'field_bindings'->'model'->>'rule' NOT IN
      ('EXACT_RAW_MODEL','CATALOG_EXACT_REFERENCE_MODEL'))
      OR (a ? 'proposed_dial_color' AND a->'field_bindings'->'dial_color'->>'rule'<>'EXPLICIT_DIAL_PHRASE')
      OR (a ? 'proposed_condition' AND a->'field_bindings'->'condition'->>'rule'<>'EXPLICIT_CONDITION_PHRASE') THEN
      RAISE EXCEPTION 'Unsupported deterministic field rule';
    END IF;
    IF a ? 'proposed_price_usd' THEN
      IF a->>'price_evidence_status'='SOURCE_EXPLICIT_USD_USDT' AND NOT (
        upper(a->>'source_currency') IN ('USD','USDT')
        AND abs((a->>'source_price_amount')::numeric-(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule'='SINGLE_EXPLICIT_USD_USDT') THEN
        RAISE EXCEPTION 'Explicit USD amount/currency binding mismatch';
      ELSIF a->>'price_evidence_status'='OWNER_ASSUMED_USD' AND NOT (
        NULLIF(btrim(COALESCE(a->>'source_currency','')),'') IS NULL
        AND abs((a->>'source_price_amount')::numeric-(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule' IN
          ('OWNER_SINGLE_BARE_DOLLAR','OWNER_SINGLE_BARE_PRICE_SHAPED_AMOUNT')) THEN
        RAISE EXCEPTION 'Owner-assumed amount binding mismatch';
      ELSIF a->>'price_evidence_status'='DATED_VERIFIED_FX' AND NOT (
        (a->>'fx_rate')::numeric>0 AND NULLIF(a->>'fx_source','') IS NOT NULL AND NULLIF(a->>'fx_date','') IS NOT NULL
        AND abs(round((a->>'source_price_amount')::numeric*(a->>'fx_rate')::numeric,2)
          -(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule'='NAMED_CURRENCY_DATED_FX') THEN
        RAISE EXCEPTION 'Dated FX arithmetic/provenance mismatch';
      END IF;
    END IF;
    v_count := v_count+1;
  END LOOP;
  RETURN jsonb_build_object('validated_count',v_count,'proposal_writes',0,'control_writes',0);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_qnsa_four_brand_enrichment(
  p_run_key text, p_mode text, p_plan_sha256 text, p_expected_count integer,
  p_canary_listing_ids uuid[] DEFAULT '{}'::uuid[], p_canary_plan_sha256 text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NULLIF(btrim(p_run_key),'') IS NULL OR p_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR upper(p_mode) NOT IN ('AUDIT','CANARY','FULL')
    OR p_expected_count NOT BETWEEN 1 AND 50000
    OR cardinality(COALESCE(p_canary_listing_ids,'{}'::uuid[])) > 40
    OR (upper(p_mode)='CANARY' AND (cardinality(COALESCE(p_canary_listing_ids,'{}'::uuid[]))=0
      OR p_canary_plan_sha256 !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Invalid four-brand enrichment run contract';
  END IF;
  INSERT INTO public.qnsa_four_brand_enrichment_runs(run_key,mode,plan_sha256,expected_count,
    canary_listing_ids,canary_plan_sha256)
  VALUES (btrim(p_run_key),upper(p_mode),p_plan_sha256,p_expected_count,
    COALESCE(p_canary_listing_ids,'{}'::uuid[]),p_canary_plan_sha256);
  RETURN jsonb_build_object('run_key',btrim(p_run_key),'status','STAGING','expected_count',p_expected_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_qnsa_four_brand_enrichment(
  p_run_key text, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,extensions,pg_catalog AS $$
DECLARE
  r jsonb; a jsonb; b jsonb; l staging.listings%ROWTYPE; v_mode text; v_count integer := 0;
  v_evidence jsonb; v_evidence_sha text; v_proposal_digest text; v_proposal_canonical text;
  v_field text; v_quote text;
BEGIN
  SELECT mode INTO v_mode FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_mode IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Each staging call requires 1..500 records';
  END IF;
  PERFORM public.validate_qnsa_four_brand_enrichment_records(p_records);

  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    a := r->'proposal_authority';
    IF jsonb_typeof(a) <> 'object' OR a->>'generator_version' <> 'four-brand-private-manifest-v1' THEN
      RAISE EXCEPTION 'Trusted private proposal authority is required';
    END IF;
    v_proposal_canonical := r->>'proposal_canonical';
    IF NULLIF(v_proposal_canonical,'') IS NULL OR v_proposal_canonical::jsonb IS DISTINCT FROM a THEN
      RAISE EXCEPTION 'Trusted proposal canonical payload mismatch';
    END IF;
    v_proposal_digest := encode(extensions.digest(convert_to(v_proposal_canonical,'UTF8'),'sha256'),'hex');
    IF v_proposal_digest IS DISTINCT FROM r->>'proposal_digest' THEN
      RAISE EXCEPTION 'Trusted proposal digest mismatch';
    END IF;
    SELECT * INTO l FROM staging.listings WHERE id=(a->>'listing_id')::uuid FOR SHARE;
    IF NOT FOUND OR l.brand_normalized NOT IN ('Tudor','Omega','Cartier','Zenith')
      OR l.brand_normalized <> a->>'canonical_brand'
      OR l.raw_message_version_id IS DISTINCT FROM (a->>'raw_message_version_id')::uuid
      OR l.source_record_id IS DISTINCT FROM a->>'source_record_id'
      OR l.source_hash IS DISTINCT FROM a->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM a->>'source_candidate_hash'
      OR NOT EXISTS (SELECT 1 FROM public.raw_message_versions rv
        WHERE rv.id=l.raw_message_version_id AND rv.source_record_id=l.source_record_id
          AND rv.source_hash=l.source_hash) THEN
      RAISE EXCEPTION 'Private exact lineage mismatch for listing %',a->>'listing_id';
    END IF;
    IF l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
      OR upper(COALESCE(l.listing_type,l.intent,'')) NOT IN ('WTS','WTB') THEN
      RAISE EXCEPTION 'Only released individual WTS/WTB watches may be enriched';
    END IF;

    v_evidence := COALESCE(a->'evidence','{}'::jsonb);
    v_evidence_sha := encode(extensions.digest(convert_to(v_evidence::text,'UTF8'),'sha256'),'hex');
    IF a ? 'proposed_model' AND NOT public.qnsa_four_brand_value_missing('model',l.model_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Model is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_reference' AND NULLIF(btrim(COALESCE(l.reference_normalized,'')),'') IS NOT NULL
      THEN RAISE EXCEPTION 'Reference is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_dial_color' AND NOT public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Dial is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_condition' AND NOT public.qnsa_four_brand_value_missing('condition',l.condition_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Condition is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_price_usd' AND (COALESCE(l.price_usd,0)>0 OR COALESCE(l.price_normalized,0)>0)
      THEN RAISE EXCEPTION 'Price is not missing for listing %',l.id; END IF;
    IF a ? 'proposed_price_usd' AND upper(COALESCE(l.listing_type,l.intent,'')) <> 'WTS'
      THEN RAISE EXCEPTION 'Price enrichment is WTS-only'; END IF;
    IF a ? 'proposed_image_url' OR a ? 'dealer_id' OR a ? 'dealer_rating' THEN
      RAISE EXCEPTION 'Images and dealers require their exact dedicated ledgers';
    END IF;

    FOREACH v_field IN ARRAY ARRAY['model','reference','dial_color','condition','price_usd'] LOOP
      IF a ? ('proposed_'||v_field) THEN
        b := a->'field_bindings'->v_field;
        v_quote := v_evidence->>(CASE WHEN v_field='dial_color' THEN 'dial_quote' ELSE v_field||'_quote' END);
        IF jsonb_typeof(b) <> 'object' OR NULLIF(v_quote,'') IS NULL
          OR strpos(COALESCE(l.raw_message_text,''),v_quote)=0
          OR b->>'quote_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(v_quote,'UTF8'),'sha256'),'hex')
          OR b->>'normalized_value' IS DISTINCT FROM a->>('proposed_'||v_field) THEN
          RAISE EXCEPTION 'Field binding mismatch for % on listing %',v_field,l.id;
        END IF;
      END IF;
    END LOOP;
    IF a ? 'proposed_reference' AND (
      COALESCE((a->>'catalog_reference_confirmed')::boolean,false)=false
      OR a->'field_bindings'->'reference'->>'rule' <> 'EXACT_RAW_REFERENCE_CATALOG_CONFIRMED') THEN
      RAISE EXCEPTION 'New references require exact raw and catalog confirmation';
    END IF;
    IF (a ? 'proposed_model' AND a->'field_bindings'->'model'->>'rule' NOT IN
      ('EXACT_RAW_MODEL','CATALOG_EXACT_REFERENCE_MODEL'))
      OR (a ? 'proposed_dial_color' AND a->'field_bindings'->'dial_color'->>'rule'<>'EXPLICIT_DIAL_PHRASE')
      OR (a ? 'proposed_condition' AND a->'field_bindings'->'condition'->>'rule'<>'EXPLICIT_CONDITION_PHRASE') THEN
      RAISE EXCEPTION 'Unsupported deterministic field rule';
    END IF;
    IF a ? 'proposed_price_usd' THEN
      IF a->>'price_evidence_status'='SOURCE_EXPLICIT_USD_USDT' AND NOT (
        upper(a->>'source_currency') IN ('USD','USDT')
        AND abs((a->>'source_price_amount')::numeric-(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule'='SINGLE_EXPLICIT_USD_USDT') THEN
        RAISE EXCEPTION 'Explicit USD amount/currency binding mismatch';
      ELSIF a->>'price_evidence_status'='OWNER_ASSUMED_USD' AND NOT (
        NULLIF(btrim(COALESCE(a->>'source_currency','')),'') IS NULL
        AND abs((a->>'source_price_amount')::numeric-(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule' IN
          ('OWNER_SINGLE_BARE_DOLLAR','OWNER_SINGLE_BARE_PRICE_SHAPED_AMOUNT')) THEN
        RAISE EXCEPTION 'Owner-assumed amount binding mismatch';
      ELSIF a->>'price_evidence_status'='DATED_VERIFIED_FX' AND NOT (
        (a->>'fx_rate')::numeric>0 AND NULLIF(a->>'fx_source','') IS NOT NULL AND NULLIF(a->>'fx_date','') IS NOT NULL
        AND abs(round((a->>'source_price_amount')::numeric*(a->>'fx_rate')::numeric,2)
          -(a->>'proposed_price_usd')::numeric)<=0.01
        AND a->'field_bindings'->'price_usd'->>'rule'='NAMED_CURRENCY_DATED_FX') THEN
        RAISE EXCEPTION 'Dated FX arithmetic/provenance mismatch';
      END IF;
    END IF;

    INSERT INTO public.qnsa_four_brand_enrichment_proposals(
      run_key,listing_id,canonical_brand,raw_message_version_id,source_record_id,source_hash,
      source_candidate_hash,proposed_model,proposed_reference,proposed_dial_color,
      proposed_condition,proposed_price_usd,price_evidence_status,source_price_amount,
      source_currency,fx_rate,fx_source,fx_date,evidence,evidence_sha256,
      generator_version,proposal_authority,proposal_digest
    ) VALUES (
      p_run_key,l.id,l.brand_normalized,l.raw_message_version_id,l.source_record_id,l.source_hash,
      l.source_candidate_hash,NULLIF(btrim(a->>'proposed_model'),''),NULLIF(btrim(a->>'proposed_reference'),''),
      NULLIF(btrim(a->>'proposed_dial_color'),''),NULLIF(btrim(a->>'proposed_condition'),''),
      NULLIF(a->>'proposed_price_usd','')::numeric,NULLIF(a->>'price_evidence_status',''),
      NULLIF(a->>'source_price_amount','')::numeric,NULLIF(btrim(a->>'source_currency'),''),
      NULLIF(a->>'fx_rate','')::numeric,NULLIF(btrim(a->>'fx_source'),''),NULLIF(a->>'fx_date','')::date,
      v_evidence,v_evidence_sha,a->>'generator_version',a,v_proposal_digest
    );
    v_count := v_count+1;
  END LOOP;
  UPDATE public.qnsa_four_brand_enrichment_runs SET updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'staged_in_call',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_qnsa_four_brand_enrichment_stage(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_expected integer; v_actual integer; v_mode text; v_canary_ids uuid[]; v_canary_sha text;
BEGIN
  SELECT expected_count,mode,canary_listing_ids,canary_plan_sha256
  INTO v_expected,v_mode,v_canary_ids,v_canary_sha FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  SELECT count(*) INTO v_actual FROM public.qnsa_four_brand_enrichment_proposals WHERE run_key=p_run_key;
  IF v_actual <> v_expected THEN RAISE EXCEPTION 'Staged % but expected %',v_actual,v_expected; END IF;
  IF v_mode='CANARY' AND (
    (SELECT count(DISTINCT id) FROM unnest(v_canary_ids) id) <> cardinality(v_canary_ids)
    OR EXISTS (SELECT 1 FROM unnest(v_canary_ids) id LEFT JOIN public.qnsa_four_brand_enrichment_proposals p
      ON p.run_key=p_run_key AND p.listing_id=id WHERE p.listing_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.qnsa_four_brand_enrichment_proposals p
      WHERE p.run_key=p_run_key AND p.listing_id=ANY(v_canary_ids)
      GROUP BY p.canonical_brand HAVING count(*)>10)
    OR v_canary_sha IS DISTINCT FROM (SELECT encode(extensions.digest(
      convert_to(string_agg(id::text,E'\n' ORDER BY id),'UTF8'),'sha256'),'hex') FROM unnest(v_canary_ids) id)
  ) THEN RAISE EXCEPTION 'Canary exact-ID plan failed reconciliation'; END IF;
  UPDATE public.qnsa_four_brand_enrichment_runs SET status='STAGED',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'status','STAGED','count',v_actual);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_qnsa_four_brand_enrichment(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.qnsa_four_brand_enrichment_control
    WHERE singleton=true AND enabled_run_key=p_run_key) THEN
    RAISE EXCEPTION 'Active runs must use atomic rollback';
  END IF;
  UPDATE public.qnsa_four_brand_enrichment_runs SET status='FAILED',updated_at=now()
    WHERE run_key=p_run_key AND status IN ('STAGING','STAGED');
  IF NOT FOUND THEN RAISE EXCEPTION 'Run cannot transition to failed'; END IF;
  RETURN jsonb_build_object('run_key',p_run_key,'status','FAILED','public_state_changed',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_qnsa_four_brand_enrichment(
  p_run_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_mode text; v_expected integer; v_plan text; v_ids uuid[]; v_invalid integer;
  v_prior jsonb; v_next jsonb; v_target_count integer;
BEGIN
  SELECT mode,expected_count,plan_sha256,canary_listing_ids
  INTO v_mode,v_expected,v_plan,v_ids FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status='STAGED' FOR UPDATE;
  IF v_mode IS NULL OR v_mode='AUDIT' THEN RAISE EXCEPTION 'Audit runs cannot activate'; END IF;
  v_target_count := CASE WHEN v_mode='CANARY' THEN cardinality(v_ids) ELSE v_expected END;
  SELECT count(*) INTO v_invalid FROM public.qnsa_four_brand_enrichment_proposals p
    LEFT JOIN staging.listings l ON l.id=p.listing_id AND l.raw_message_version_id=p.raw_message_version_id
      AND l.source_record_id=p.source_record_id AND l.source_hash=p.source_hash
      AND l.source_candidate_hash=p.source_candidate_hash AND l.brand_normalized=p.canonical_brand
    WHERE p.run_key=p_run_key AND (v_mode<>'CANARY' OR p.listing_id=ANY(v_ids))
      AND (l.id IS NULL OR NOT (
        (p.proposed_model IS NULL OR public.qnsa_four_brand_value_missing('model',l.model_normalized,l.brand_normalized))
        AND (p.proposed_reference IS NULL OR NULLIF(btrim(COALESCE(l.reference_normalized,'')),'') IS NULL)
        AND (p.proposed_dial_color IS NULL OR public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,l.brand_normalized))
        AND (p.proposed_condition IS NULL OR public.qnsa_four_brand_value_missing('condition',l.condition_normalized,l.brand_normalized))
        AND (p.proposed_price_usd IS NULL OR (COALESCE(l.price_usd,0)<=0 AND COALESCE(l.price_normalized,0)<=0
          AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'))
      ));
  IF v_invalid<>0 OR (SELECT count(*) FROM public.qnsa_four_brand_enrichment_proposals p
      WHERE p.run_key=p_run_key AND (v_mode<>'CANARY' OR p.listing_id=ANY(v_ids)))<>v_target_count THEN
    RAISE EXCEPTION 'Atomic activation revalidation failed';
  END IF;
  SELECT to_jsonb(c) INTO v_prior FROM public.qnsa_four_brand_enrichment_control c
    WHERE singleton=true FOR UPDATE;
  v_next := jsonb_build_object('singleton',true,'enabled_run_key',p_run_key,
    'enabled_mode',v_mode,'enabled_listing_ids',CASE WHEN v_mode='CANARY' THEN to_jsonb(v_ids) ELSE '[]'::jsonb END,
    'plan_sha256',v_plan);
  UPDATE public.qnsa_four_brand_enrichment_control SET enabled_run_key=p_run_key,
    enabled_mode=v_mode,enabled_listing_ids=CASE WHEN v_mode='CANARY' THEN v_ids ELSE '{}'::uuid[] END,
    plan_sha256=v_plan,updated_at=now() WHERE singleton=true;
  INSERT INTO public.qnsa_four_brand_enrichment_rollback_ledger(run_key,action,prior_control,next_control)
    VALUES(p_run_key,'CONTROL_SWITCH',v_prior,v_next);
  UPDATE public.qnsa_four_brand_enrichment_runs SET
    status=CASE WHEN v_mode='CANARY' THEN 'CANARY_ACTIVE' ELSE 'FULL_ACTIVE' END,updated_at=now()
  WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'active_total',v_target_count,'mode',v_mode,
    'atomic_control_switch',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_qnsa_four_brand_enrichment(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_prior jsonb; v_current jsonb;
BEGIN
  SELECT to_jsonb(c) INTO v_current FROM public.qnsa_four_brand_enrichment_control c
    WHERE singleton=true AND enabled_run_key=p_run_key FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Run is not the active control pointer'; END IF;
  SELECT prior_control INTO v_prior FROM public.qnsa_four_brand_enrichment_rollback_ledger
    WHERE run_key=p_run_key AND action='CONTROL_SWITCH' ORDER BY event_id DESC LIMIT 1;
  IF v_prior IS NULL THEN RAISE EXCEPTION 'Rollback control snapshot is unavailable'; END IF;
  UPDATE public.qnsa_four_brand_enrichment_control SET
    enabled_run_key=NULLIF(v_prior->>'enabled_run_key','')::text,
    enabled_mode=NULLIF(v_prior->>'enabled_mode','')::text,
    enabled_listing_ids=COALESCE(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
      COALESCE(v_prior->'enabled_listing_ids','[]'::jsonb)) AS value),'{}'::uuid[]),
    plan_sha256=NULLIF(v_prior->>'plan_sha256','')::text,updated_at=now() WHERE singleton=true;
  INSERT INTO public.qnsa_four_brand_enrichment_rollback_ledger(run_key,action,prior_control,next_control)
    VALUES(p_run_key,'ROLLBACK',v_current,v_prior);
  UPDATE public.qnsa_four_brand_enrichment_runs SET status='ROLLED_BACK',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'rolled_back',true,'atomic_control_switch',true);
END;
$$;

CREATE OR REPLACE VIEW public.qnsa_four_brand_effective_enrichment
WITH (security_invoker=true) AS
SELECT p.* FROM public.qnsa_four_brand_enrichment_control c
JOIN public.qnsa_four_brand_enrichment_proposals p ON p.run_key=c.enabled_run_key
WHERE c.singleton=true AND (c.enabled_mode='FULL'
  OR (c.enabled_mode='CANARY' AND p.listing_id=ANY(c.enabled_listing_ids)));

-- Bounded API overlay. It returns only sidecar values whose private lineage
-- still matches the immutable listing. The calling API merges these before
-- customer filtering, search and Price Research eligibility evaluation.
CREATE OR REPLACE FUNCTION public.qnsa_four_brand_effective_enrichments(p_listing_ids uuid[])
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'listing_id',p.listing_id::text,'canonical_brand',p.canonical_brand,
    'model',p.proposed_model,'reference',p.proposed_reference,'dial_color',p.proposed_dial_color,
    'condition',p.proposed_condition,'price_usd',p.proposed_price_usd,
    'price_evidence_status',p.price_evidence_status,'source_price_amount',p.source_price_amount,
    'source_currency',p.source_currency,'fx_rate',p.fx_rate,'fx_source',p.fx_source,'fx_date',p.fx_date,
    'run_key',p.run_key
  ))
  FROM public.qnsa_four_brand_effective_enrichment p
  JOIN staging.listings l ON l.id=p.listing_id AND l.raw_message_version_id=p.raw_message_version_id
    AND l.source_record_id=p.source_record_id AND l.source_hash=p.source_hash
    AND l.source_candidate_hash=p.source_candidate_hash AND l.brand_normalized=p.canonical_brand
  WHERE p.listing_id=ANY(COALESCE(p_listing_ids,'{}'::uuid[]))
    AND cardinality(COALESCE(p_listing_ids,'{}'::uuid[])) <= 101;
$$;

-- Filter-aware customer page. Unlike a post-fetch merge, this applies model,
-- reference, dial, condition and free-text predicates to the effective values
-- before LIMIT/OFFSET, so enriched rows remain discoverable.
CREATE OR REPLACE FUNCTION public.qnsa_four_brand_effective_page_rows(
  p_brand text, p_limit integer DEFAULT 51, p_offset integer DEFAULT 0,
  p_listing_type text DEFAULT NULL, p_model text DEFAULT NULL,
  p_reference text DEFAULT NULL, p_dial text DEFAULT NULL,
  p_condition text DEFAULT NULL, p_search text DEFAULT NULL,
  p_references text[] DEFAULT NULL, p_images_only boolean DEFAULT false,
  p_priced_only boolean DEFAULT false, p_posted_after timestamptz DEFAULT NULL,
  p_region text DEFAULT NULL, p_rating text DEFAULT NULL
) RETURNS TABLE(row_data jsonb) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
  WITH released AS (
    SELECT 'Omega'::text brand,m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_omega_release_control c JOIN public.qnsa_omega_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Omega' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Cartier',m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_cartier_release_control c JOIN public.qnsa_cartier_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Cartier' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Tudor',m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_tudor_release_control c JOIN public.qnsa_tudor_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Tudor' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Zenith',l.id,
      row_number() OVER (ORDER BY
        COALESCE(NULLIF(btrim(l.image_url),'') ~* '^https?://[^[:space:]]+$',false) DESC,
        (l.price_usd>0 AND (l.currency_normalized IN ('USD','USDT') OR
          (l.conversion_rate>0 AND l.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(l.conversion_source),'') IS NOT NULL))) DESC,
        l.created_at DESC,l.id DESC)::integer,
      COALESCE(NULLIF(btrim(l.model_normalized),''),NULLIF(btrim(l.model_original),'')),
      l.reference_normalized,true,
      CASE WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd>0 THEN 'SOURCE_EXPLICIT_USD_USDT'
        WHEN l.price_usd>0 AND l.conversion_rate>0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source),'') IS NOT NULL THEN 'DATED_VERIFIED_FX'
        WHEN l.price_normalized>0 THEN 'SOURCE_CURRENCY_REQUIRES_REVIEW' ELSE 'PRICE_NOT_SUPPLIED' END,
      l.source_hash,l.source_candidate_hash
    FROM staging.listings l
    JOIN public.qnsa_two_brand_release_control c ON c.canonical_brand='Zenith'
      AND c.trading_floor_enabled AND l.normalization_run_key=c.enabled_run_key
    JOIN staging.qnsa_zenith_identity_reconciliation_audit z ON z.listing_id=l.id
      AND z.normalization_run_key=l.normalization_run_key
      AND z.reconciliation_run_key='zenith-identity-20260814-v1'
      AND z.decision='RELEASE_SAFE' AND z.corrected_reference=l.reference_normalized
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=l.id
    WHERE btrim(p_brand)='Zenith'
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,l.model_normalized,l.model_original,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,l.reference_normalized,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,l.reference_normalized,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
  ), source_rows AS (
    SELECT r.brand,r.release_order,r.public_model,r.public_reference,r.catalog_reference_confirmed,
      r.price_lane,l.id,l.source_record_id,l.created_at,l.user_name,l.from_name,l.raw_message_text,
      l.brand_original,l.reference_original,l.dial_color_normalized,l.condition_normalized,
      l.price_usd,l.price_normalized,l.currency_normalized,l.overall_confidence,l.verdict,l.location,
      upper(COALESCE(l.listing_type,l.intent,'')) effective_intent,
      p.proposed_model,p.proposed_reference,p.proposed_dial_color,p.proposed_condition,
      COALESCE((p.proposal_authority->>'catalog_reference_confirmed')::boolean,false)
        proposed_catalog_reference_confirmed,
      p.proposed_price_usd,p.price_evidence_status proposed_price_status,
      p.source_price_amount proposed_source_amount,p.source_currency proposed_source_currency,
      p.fx_rate proposed_fx_rate,p.fx_source proposed_fx_source,p.fx_date proposed_fx_date,
      p.run_key field_enrichment_run_key,
      dl.dealer_id exact_dealer_id,
      d.rating exact_dealer_rating,d.review_count exact_dealer_review_count,
      CASE WHEN NULLIF(btrim(l.image_url),'') ~* '^https?://[^[:space:]]+$'
        THEN btrim(l.image_url) END verified_image_url
    FROM released r JOIN staging.listings l ON l.id=r.listing_id
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    LEFT JOIN public.qnsa_four_brand_effective_enrichment p ON p.listing_id=l.id
      AND p.raw_message_version_id=l.raw_message_version_id AND p.source_record_id=l.source_record_id
      AND p.source_hash=l.source_hash AND p.source_candidate_hash=l.source_candidate_hash
      AND p.canonical_brand=l.brand_normalized
    LEFT JOIN public.dealer_listing_links dl ON dl.listing_id=l.id AND dl.link_status='APPLIED'
    LEFT JOIN public.dealers d ON d.id=dl.dealer_id AND d.status='VERIFIED'
    WHERE l.brand_normalized=r.brand AND l.source_hash=r.source_hash
      AND l.source_candidate_hash=r.source_candidate_hash
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (p_listing_type IS NULL OR upper(COALESCE(l.listing_type,l.intent,''))=upper(p_listing_type))
      AND (COALESCE(p_images_only,false)=false
        OR NULLIF(btrim(l.image_url),'') ~* '^https?://[^[:space:]]+$')
      AND (COALESCE(p_priced_only,false)=false OR COALESCE(p.proposed_price_usd,l.price_usd,l.price_normalized,0)>0)
      AND (p_posted_after IS NULL OR l.created_at>=p_posted_after)
      AND (p_region IS NULL OR COALESCE(l.location,'') ILIKE '%'||p_region||'%')
      AND (p_rating IS NULL OR (lower(p_rating)='rated' AND d.review_count>0)
        OR (lower(p_rating)='unrated' AND COALESCE(d.review_count,0)=0))
  ), effective AS (
    SELECT s.*,
      CASE WHEN public.qnsa_four_brand_value_missing('model',s.public_model,s.brand)
        THEN COALESCE(s.proposed_model,s.public_model) ELSE s.public_model END effective_model,
      COALESCE(NULLIF(btrim(s.public_reference),''),s.proposed_reference) effective_reference,
      CASE WHEN public.qnsa_four_brand_value_missing('dial',s.dial_color_normalized,s.brand)
        THEN COALESCE(s.proposed_dial_color,s.dial_color_normalized) ELSE s.dial_color_normalized END effective_dial,
      CASE WHEN public.qnsa_four_brand_value_missing('condition',s.condition_normalized,s.brand)
        THEN COALESCE(s.proposed_condition,s.condition_normalized) ELSE s.condition_normalized END effective_condition
    FROM source_rows s
  ), selected AS (
    SELECT * FROM effective e
    WHERE (p_model IS NULL OR lower(btrim(COALESCE(e.effective_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(e.effective_reference,'')),'[^A-Z0-9]','','g')
        =regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(e.effective_reference,'')),'[^A-Z0-9]','','g')
        =ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
      AND (p_dial IS NULL OR lower(btrim(COALESCE(e.effective_dial,'')))=lower(btrim(p_dial)))
      AND (p_condition IS NULL OR lower(btrim(COALESCE(e.effective_condition,'')))=lower(btrim(p_condition)))
      AND (p_search IS NULL OR NOT EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(btrim(p_search)),'\s+') term
        WHERE concat_ws(' ',e.brand,e.effective_model,e.effective_reference,e.effective_dial,
          e.effective_condition,e.raw_message_text,e.user_name,e.from_name) NOT ILIKE '%'||term||'%'
      ))
    ORDER BY e.release_order
    LIMIT LEAST(GREATEST(COALESCE(p_limit,51),1),2500)
    OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT jsonb_build_object(
    'id',s.id::text,'parent_id',NULL,'source_file','MARIADB_IMMUTABLE_RAW','source_row_number',1,
    'source_record_id',s.source_record_id,'posting_date',s.created_at,
    'seller_name',COALESCE(NULLIF(btrim(s.user_name),''),NULLIF(btrim(s.from_name),''),'Source dealer'),
    'seller_phone',NULL,'contact_publication_approved',false,'raw_message',s.raw_message_text,
    'listing_type',s.effective_intent,'brand_scope',s.brand,'supplied_brand',s.brand_original,
    'canonical_brand',s.brand,'model',s.effective_model,'catalog_model',s.effective_model,
    'raw_reference',CASE WHEN s.effective_reference IS NOT NULL THEN s.reference_original END,
    'normalized_reference',s.effective_reference,
    'catalog_reference',CASE WHEN s.catalog_reference_confirmed OR s.proposed_catalog_reference_confirmed
      THEN s.effective_reference END,
    'catalog_reference_confirmed',s.catalog_reference_confirmed OR s.proposed_catalog_reference_confirmed
  ) || jsonb_build_object(
    'dial_color',s.effective_dial,'catalog_dial',s.effective_dial,'condition',s.effective_condition,
    'workbook_price_usd',CASE
      WHEN s.proposed_price_usd>0 THEN s.proposed_price_usd
      WHEN s.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN s.price_usd
      WHEN s.price_lane='OWNER_ASSUMED_USD_CANDIDATE' THEN s.price_normalized END,
    'price_usd',CASE
      WHEN s.proposed_price_usd>0 THEN s.proposed_price_usd
      WHEN s.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN s.price_usd
      WHEN s.price_lane='OWNER_ASSUMED_USD_CANDIDATE' THEN s.price_normalized END,
    'source_price_amount',COALESCE(s.proposed_source_amount,s.proposed_price_usd,s.price_normalized),
    'source_currency',COALESCE(s.proposed_source_currency,s.currency_normalized),
    'price_evidence_status',COALESCE(s.proposed_price_status,s.price_lane),
    'confidence',s.overall_confidence,'verdict',s.verdict,'verification_status','APPROVED_SINGLE_CANDIDATE',
    'user_image_url',s.verified_image_url,'imported_at',s.created_at,
    'has_exact_source_image',s.verified_image_url IS NOT NULL,
    'verified_price_usd',CASE WHEN COALESCE(s.proposed_price_status,s.price_lane) IN
      ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN COALESCE(s.proposed_price_usd,s.price_usd) END,
    'has_verified_usd_price',COALESCE(s.proposed_price_status,s.price_lane) IN
      ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') AND COALESCE(s.proposed_price_usd,s.price_usd,0)>0,
    'has_complete_identity',s.effective_reference IS NOT NULL,'trading_floor_status','RELEASED_'||upper(s.brand),
    'reference_search_key',regexp_replace(upper(COALESCE(s.effective_reference,'')),'[^A-Z0-9]','','g'),
    'location',NULLIF(btrim(s.location),''),'item_category','WATCH','publication_state','APPROVED',
    'publication_lane','QNSA_FOUR_BRAND_EFFECTIVE_SIDECAR_V1','normalization_run_complete',true,
    'raw_lineage_verified',true,'dealer_id',s.exact_dealer_id,'dealer_rating',s.exact_dealer_rating,
    'review_count',s.exact_dealer_review_count,
    'field_enrichment_run_key',s.field_enrichment_run_key,'analytics_fx_rate',s.proposed_fx_rate,
    'analytics_fx_source',s.proposed_fx_source,'analytics_fx_date',s.proposed_fx_date
  ) FROM selected s ORDER BY s.release_order;
$$;

REVOKE ALL ON FUNCTION public.qnsa_four_brand_value_missing(text,text,text),
  public.qnsa_four_brand_private_enrichment_candidates(uuid[]),
  public.validate_qnsa_four_brand_enrichment_records(jsonb),
  public.begin_qnsa_four_brand_enrichment(text,text,text,integer,uuid[],text),
  public.stage_qnsa_four_brand_enrichment(text,jsonb),
  public.finalize_qnsa_four_brand_enrichment_stage(text),
  public.fail_qnsa_four_brand_enrichment(text),
  public.activate_qnsa_four_brand_enrichment(text),
  public.rollback_qnsa_four_brand_enrichment(text),
  public.qnsa_four_brand_effective_enrichments(uuid[]),
  public.qnsa_four_brand_effective_page_rows(text,integer,integer,text,text,text,text,text,text,text[],boolean,boolean,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_four_brand_value_missing(text,text,text),
  public.qnsa_four_brand_private_enrichment_candidates(uuid[]),
  public.validate_qnsa_four_brand_enrichment_records(jsonb),
  public.begin_qnsa_four_brand_enrichment(text,text,text,integer,uuid[],text),
  public.stage_qnsa_four_brand_enrichment(text,jsonb),
  public.finalize_qnsa_four_brand_enrichment_stage(text),
  public.fail_qnsa_four_brand_enrichment(text),
  public.activate_qnsa_four_brand_enrichment(text),
  public.rollback_qnsa_four_brand_enrichment(text),
  public.qnsa_four_brand_effective_enrichments(uuid[]),
  public.qnsa_four_brand_effective_page_rows(text,integer,integer,text,text,text,text,text,text,text[],boolean,boolean,timestamptz,text,text)
  TO service_role;
REVOKE ALL ON public.qnsa_four_brand_effective_enrichment FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.qnsa_four_brand_effective_enrichment TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
