-- Exact, reversible, null-only completion for canonical Rolex listings.
-- Raw evidence and every populated staging value remain immutable.

BEGIN;

CREATE TABLE public.qnsa_rolex_null_only_completion_runs (
  run_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('CANARY','FULL')),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256~'^[0-9a-f]{64}$'),
  expected_count integer NOT NULL CHECK (expected_count BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'STAGING' CHECK (status IN ('STAGING','STAGED','ACTIVE','ROLLED_BACK')),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.qnsa_rolex_null_only_completion_proposals (
  run_key text NOT NULL REFERENCES public.qnsa_rolex_null_only_completion_runs(run_key),
  listing_id uuid NOT NULL,raw_message_version_id uuid NOT NULL,source_record_id text NOT NULL,
  source_hash text NOT NULL CHECK(source_hash~'^[0-9a-f]{64}$'),
  source_candidate_hash text NOT NULL CHECK(source_candidate_hash~'^[0-9a-f]{64}$'),
  normalized_reference text NOT NULL,
  proposed_price_usd numeric,source_price_amount numeric,source_currency text,currency_evidence text,
  conversion_rate numeric,conversion_timestamp timestamptz,conversion_source text,
  proposed_image_url text,source_media_key text,source_media_sha256 text,image_verified_at timestamptz,
  proposal_sha256 text NOT NULL CHECK(proposal_sha256~'^[0-9a-f]{64}$'),
  PRIMARY KEY(run_key,listing_id),
  CHECK(proposed_price_usd IS NOT NULL OR proposed_image_url IS NOT NULL),
  CHECK(proposed_price_usd IS NULL OR (proposed_price_usd>0 AND source_price_amount>0
    AND source_currency IN ('USD','USDT','HKD','EUR','GBP','CHF','SGD','CNY','JPY','KRW','THB','CAD','AUD','NZD',
      'MYR','IDR','INR','PHP','BRL','MXN','ZAR','SEK','NOK','DKK')
    AND currency_evidence IS NOT NULL AND currency_evidence<>'usd_defaulted_by_policy'
    AND conversion_rate>0 AND NULLIF(btrim(conversion_source),'') IS NOT NULL)),
  CHECK(proposed_image_url IS NULL OR (proposed_image_url~'^https://thecollective-prod\.nyc3\.digitaloceanspaces\.com/listings/full/[^[:space:]]+$'
    AND NULLIF(btrim(source_media_key),'') IS NOT NULL AND source_media_sha256~'^[0-9a-f]{64}$'
    AND image_verified_at IS NOT NULL))
);

CREATE TABLE public.qnsa_rolex_null_only_completion_snapshots (
  run_key text NOT NULL REFERENCES public.qnsa_rolex_null_only_completion_runs(run_key),listing_id uuid NOT NULL,
  prior_price_original numeric,prior_price_normalized numeric,prior_price_usd numeric,
  prior_currency_original text,prior_currency_normalized text,prior_currency_evidence text,
  prior_conversion_rate numeric,prior_conversion_timestamp timestamptz,prior_conversion_source text,
  prior_image_url text,prior_source_media_key text,prior_source_media_url_candidate text,
  prior_public_image_eligible boolean,PRIMARY KEY(run_key,listing_id)
);

ALTER TABLE public.qnsa_rolex_null_only_completion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_rolex_null_only_completion_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_rolex_null_only_completion_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qnsa_rolex_null_only_completion_runs,public.qnsa_rolex_null_only_completion_proposals,
  public.qnsa_rolex_null_only_completion_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.qnsa_rolex_null_only_completion_runs,
  public.qnsa_rolex_null_only_completion_proposals,public.qnsa_rolex_null_only_completion_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.begin_qnsa_rolex_null_only_completion(
  p_run_key text,p_mode text,p_manifest_sha256 text,p_expected_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF p_run_key!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{5,119}$' OR upper(p_mode) NOT IN ('CANARY','FULL')
    OR p_manifest_sha256!~'^[0-9a-f]{64}$' OR p_expected_count NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Invalid Rolex null-only run contract'; END IF;
  INSERT INTO public.qnsa_rolex_null_only_completion_runs(run_key,mode,manifest_sha256,expected_count)
    VALUES(p_run_key,upper(p_mode),p_manifest_sha256,p_expected_count);
  RETURN jsonb_build_object('run_key',p_run_key,'status','STAGING');
END; $$;

CREATE OR REPLACE FUNCTION public.stage_qnsa_rolex_null_only_completion(p_run_key text,p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,extensions,pg_catalog AS $$
DECLARE r jsonb;l staging.listings%ROWTYPE;v_count integer:=0;v_canonical text;v_digest text;
BEGIN
  PERFORM 1 FROM public.qnsa_rolex_null_only_completion_runs WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  IF jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Stage requires 1..500 records'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    v_canonical:=r->>'proposal_canonical';
    v_digest:=encode(extensions.digest(convert_to(COALESCE(v_canonical,''),'UTF8'),'sha256'),'hex');
    IF v_canonical::jsonb IS DISTINCT FROM r-'proposal_canonical'-'proposal_sha256'
      OR v_digest IS DISTINCT FROM r->>'proposal_sha256' THEN RAISE EXCEPTION 'Proposal digest mismatch'; END IF;
    SELECT * INTO l FROM staging.listings WHERE id=(r->>'listing_id')::uuid;
    IF NOT FOUND OR l.brand_normalized IS DISTINCT FROM 'Rolex'
      OR l.raw_message_version_id IS DISTINCT FROM (r->>'raw_message_version_id')::uuid
      OR l.source_record_id IS DISTINCT FROM r->>'source_record_id' OR l.source_hash IS DISTINCT FROM r->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM r->>'source_candidate_hash'
      OR regexp_replace(upper(l.reference_normalized),'[^A-Z0-9]','','g') IS DISTINCT FROM
        regexp_replace(upper(r->>'normalized_reference'),'[^A-Z0-9]','','g')
      OR l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
      OR COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')<>'SINGLE_CANDIDATE'
      OR upper(COALESCE(l.listing_type,l.intent,''))<>'WTS'
      OR NOT EXISTS(SELECT 1 FROM public.raw_message_versions v WHERE v.id=l.raw_message_version_id
        AND v.source_record_id=l.source_record_id AND v.source_hash=l.source_hash) THEN
      RAISE EXCEPTION 'Exact Rolex lineage mismatch for %',r->>'listing_id'; END IF;
    IF r ? 'proposed_price_usd' AND (COALESCE(l.price_usd,l.price_normalized,0)>0
      OR (r->>'currency_evidence')='usd_defaulted_by_policy') THEN RAISE EXCEPTION 'Price is not null-only or explicit'; END IF;
    IF r ? 'proposed_image_url' AND (NULLIF(btrim(COALESCE(l.image_url,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(l.source_media_url_candidate,'')),'') IS NOT NULL) THEN
      RAISE EXCEPTION 'Image is not null-only'; END IF;
    IF r ? 'proposed_price_usd' AND NOT (
      (upper(r->>'source_currency') IN ('USD','USDT') AND (r->>'conversion_rate')::numeric=1
        AND abs((r->>'source_price_amount')::numeric-(r->>'proposed_price_usd')::numeric)<=0.01)
      OR (upper(r->>'source_currency') NOT IN ('USD','USDT') AND NULLIF(r->>'conversion_timestamp','') IS NOT NULL
        AND abs(round((r->>'source_price_amount')::numeric*(r->>'conversion_rate')::numeric)
          -(r->>'proposed_price_usd')::numeric)<=1.01)) THEN RAISE EXCEPTION 'Price conversion mismatch'; END IF;
    IF r ? 'proposed_image_url' AND (r->>'source_media_sha256') IS DISTINCT FROM
      encode(extensions.digest(convert_to(r->>'source_media_key','UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION 'Image media binding mismatch'; END IF;
    INSERT INTO public.qnsa_rolex_null_only_completion_proposals(run_key,listing_id,raw_message_version_id,
      source_record_id,source_hash,source_candidate_hash,normalized_reference,proposed_price_usd,source_price_amount,
      source_currency,currency_evidence,conversion_rate,conversion_timestamp,conversion_source,proposed_image_url,
      source_media_key,source_media_sha256,image_verified_at,proposal_sha256)
    VALUES(p_run_key,(r->>'listing_id')::uuid,(r->>'raw_message_version_id')::uuid,r->>'source_record_id',r->>'source_hash',
      r->>'source_candidate_hash',r->>'normalized_reference',NULLIF(r->>'proposed_price_usd','')::numeric,
      NULLIF(r->>'source_price_amount','')::numeric,NULLIF(r->>'source_currency',''),NULLIF(r->>'currency_evidence',''),
      NULLIF(r->>'conversion_rate','')::numeric,NULLIF(r->>'conversion_timestamp','')::timestamptz,
      NULLIF(r->>'conversion_source',''),NULLIF(r->>'proposed_image_url',''),NULLIF(r->>'source_media_key',''),
      NULLIF(r->>'source_media_sha256',''),NULLIF(r->>'image_verified_at','')::timestamptz,r->>'proposal_sha256');
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('staged',v_count);
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_qnsa_rolex_null_only_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_expected integer;v_actual integer;
BEGIN
  SELECT expected_count INTO v_expected FROM public.qnsa_rolex_null_only_completion_runs
    WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  SELECT count(*) INTO v_actual FROM public.qnsa_rolex_null_only_completion_proposals WHERE run_key=p_run_key;
  IF v_actual<>v_expected THEN RAISE EXCEPTION 'Staged % but expected %',v_actual,v_expected; END IF;
  UPDATE public.qnsa_rolex_null_only_completion_runs SET status='STAGED',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('staged',v_actual);
END; $$;

CREATE OR REPLACE FUNCTION public.activate_qnsa_rolex_null_only_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog SET statement_timeout='180s' AS $$
DECLARE v_expected integer;v_invalid integer;v_updated integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('qnsa_rolex_null_only_completion'));
  SELECT expected_count INTO v_expected FROM public.qnsa_rolex_null_only_completion_runs
    WHERE run_key=p_run_key AND status='STAGED' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staged'; END IF;
  SELECT count(*) INTO v_invalid FROM public.qnsa_rolex_null_only_completion_proposals p
  LEFT JOIN staging.listings l ON l.id=p.listing_id AND l.brand_normalized='Rolex'
    AND l.raw_message_version_id=p.raw_message_version_id AND l.source_record_id=p.source_record_id
    AND l.source_hash=p.source_hash AND l.source_candidate_hash=p.source_candidate_hash
  WHERE p.run_key=p_run_key AND (l.id IS NULL OR l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
    OR (p.proposed_price_usd IS NOT NULL AND COALESCE(l.price_usd,l.price_normalized,0)>0)
    OR (p.proposed_image_url IS NOT NULL AND (NULLIF(btrim(COALESCE(l.image_url,'')),'') IS NOT NULL
      OR NULLIF(btrim(COALESCE(l.source_media_url_candidate,'')),'') IS NOT NULL)));
  IF v_invalid<>0 THEN RAISE EXCEPTION 'Activation revalidation failed for % rows',v_invalid; END IF;
  INSERT INTO public.qnsa_rolex_null_only_completion_snapshots(run_key,listing_id,prior_price_original,
    prior_price_normalized,prior_price_usd,prior_currency_original,prior_currency_normalized,prior_currency_evidence,
    prior_conversion_rate,prior_conversion_timestamp,prior_conversion_source,prior_image_url,prior_source_media_key,
    prior_source_media_url_candidate,prior_public_image_eligible)
  SELECT p_run_key,l.id,l.price_original,l.price_normalized,l.price_usd,l.currency_original,l.currency_normalized,
    l.currency_evidence,l.conversion_rate,l.conversion_timestamp,l.conversion_source,l.image_url,l.source_media_key,
    l.source_media_url_candidate,l.public_image_eligible
  FROM public.qnsa_rolex_null_only_completion_proposals p JOIN staging.listings l ON l.id=p.listing_id
  WHERE p.run_key=p_run_key;
  UPDATE staging.listings l SET price_original=COALESCE(p.source_price_amount,l.price_original),
    price_normalized=COALESCE(p.source_price_amount,l.price_normalized),price_usd=COALESCE(p.proposed_price_usd,l.price_usd),
    currency_original=COALESCE(p.source_currency,l.currency_original),currency_normalized=COALESCE(p.source_currency,l.currency_normalized),
    currency_evidence=COALESCE(p.currency_evidence,l.currency_evidence),conversion_rate=COALESCE(p.conversion_rate,l.conversion_rate),
    conversion_timestamp=CASE WHEN p.proposed_price_usd IS NULL THEN l.conversion_timestamp
      WHEN p.source_currency IN ('USD','USDT') THEN NULL ELSE p.conversion_timestamp END,
    conversion_source=COALESCE(p.conversion_source,l.conversion_source),image_url=COALESCE(p.proposed_image_url,l.image_url),
    source_media_key=COALESCE(p.source_media_key,l.source_media_key),
    source_media_url_candidate=COALESCE(p.proposed_image_url,l.source_media_url_candidate),
    public_image_eligible=CASE WHEN p.proposed_image_url IS NOT NULL THEN true ELSE l.public_image_eligible END
  FROM public.qnsa_rolex_null_only_completion_proposals p WHERE p.run_key=p_run_key AND l.id=p.listing_id;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>v_expected THEN RAISE EXCEPTION 'Updated % but expected %',v_updated,v_expected; END IF;
  UPDATE public.qnsa_rolex_null_only_completion_runs SET status='ACTIVE',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('updated',v_updated,'active',true);
END; $$;

CREATE OR REPLACE FUNCTION public.rollback_qnsa_rolex_null_only_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog SET statement_timeout='180s' AS $$
DECLARE v_expected integer;v_restored integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('qnsa_rolex_null_only_completion'));
  SELECT expected_count INTO v_expected FROM public.qnsa_rolex_null_only_completion_runs
    WHERE run_key=p_run_key AND status='ACTIVE' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not active'; END IF;
  UPDATE staging.listings l SET price_original=s.prior_price_original,price_normalized=s.prior_price_normalized,
    price_usd=s.prior_price_usd,currency_original=s.prior_currency_original,currency_normalized=s.prior_currency_normalized,
    currency_evidence=s.prior_currency_evidence,conversion_rate=s.prior_conversion_rate,
    conversion_timestamp=s.prior_conversion_timestamp,conversion_source=s.prior_conversion_source,
    image_url=s.prior_image_url,source_media_key=s.prior_source_media_key,
    source_media_url_candidate=s.prior_source_media_url_candidate,public_image_eligible=s.prior_public_image_eligible
  FROM public.qnsa_rolex_null_only_completion_snapshots s WHERE s.run_key=p_run_key AND l.id=s.listing_id;
  GET DIAGNOSTICS v_restored=ROW_COUNT;
  IF v_restored<>v_expected THEN RAISE EXCEPTION 'Restored % but expected %',v_restored,v_expected; END IF;
  UPDATE public.qnsa_rolex_null_only_completion_runs SET status='ROLLED_BACK',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('restored',v_restored,'rolled_back',true);
END; $$;

REVOKE ALL ON FUNCTION public.begin_qnsa_rolex_null_only_completion(text,text,text,integer),
  public.stage_qnsa_rolex_null_only_completion(text,jsonb),public.finalize_qnsa_rolex_null_only_completion(text),
  public.activate_qnsa_rolex_null_only_completion(text),public.rollback_qnsa_rolex_null_only_completion(text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_qnsa_rolex_null_only_completion(text,text,text,integer),
  public.stage_qnsa_rolex_null_only_completion(text,jsonb),public.finalize_qnsa_rolex_null_only_completion(text),
  public.activate_qnsa_rolex_null_only_completion(text),public.rollback_qnsa_rolex_null_only_completion(text)
  TO service_role;

COMMIT;
