-- Exact, reversible missing-image and missing-price completion for the
-- controlled Omega, Zenith, Cartier and Tudor release lanes.
-- Raw evidence is immutable. Only blank derived staging fields are filled.

BEGIN;

CREATE TABLE public.qnsa_four_brand_source_completion_runs (
  run_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('CANARY','FULL')),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  expected_count integer NOT NULL CHECK (expected_count BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'STAGING' CHECK (status IN
    ('STAGING','STAGED','ACTIVE','ROLLED_BACK','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.qnsa_four_brand_source_completion_proposals (
  run_key text NOT NULL REFERENCES public.qnsa_four_brand_source_completion_runs(run_key),
  listing_id uuid NOT NULL,
  canonical_brand text NOT NULL CHECK (canonical_brand IN ('Omega','Zenith','Cartier','Tudor')),
  raw_message_version_id uuid NOT NULL,
  source_record_id text NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_candidate_hash text NOT NULL CHECK (source_candidate_hash ~ '^[0-9a-f]{64}$'),
  source_auction_id uuid NOT NULL,
  proposed_image_url text,
  source_media_key text,
  source_media_sha256 text CHECK (source_media_sha256 IS NULL OR source_media_sha256 ~ '^[0-9a-f]{64}$'),
  image_verified_at timestamptz,
  proposed_price_usd numeric,
  source_price_amount numeric,
  source_currency text,
  price_evidence_status text CHECK (price_evidence_status IS NULL OR price_evidence_status IN
    ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX','OWNER_ASSUMED_USD')),
  fx_rate numeric,
  fx_source text,
  fx_date date,
  price_evidence_quote text,
  proposal_sha256 text NOT NULL CHECK (proposal_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_key,listing_id),
  CHECK (proposed_image_url IS NOT NULL OR proposed_price_usd IS NOT NULL),
  CHECK (proposed_image_url IS NULL OR (
    proposed_image_url ~ '^https://thecollective-prod\.nyc3\.digitaloceanspaces\.com/listings/full/[^[:space:]]+$'
    AND NULLIF(btrim(source_media_key),'') IS NOT NULL
    AND source_media_sha256 IS NOT NULL AND image_verified_at IS NOT NULL)),
  CHECK (proposed_price_usd IS NULL OR (proposed_price_usd > 0
    AND source_price_amount > 0 AND price_evidence_status IS NOT NULL
    AND NULLIF(btrim(price_evidence_quote),'') IS NOT NULL)),
  CHECK (price_evidence_status <> 'DATED_VERIFIED_FX' OR
    (fx_rate > 0 AND NULLIF(btrim(fx_source),'') IS NOT NULL AND fx_date IS NOT NULL))
);

CREATE TABLE public.qnsa_four_brand_source_completion_snapshots (
  run_key text NOT NULL REFERENCES public.qnsa_four_brand_source_completion_runs(run_key),
  listing_id uuid NOT NULL,
  prior_image_url text,
  prior_source_media_key text,
  prior_source_media_url_candidate text,
  prior_public_image_eligible boolean,
  prior_price_original numeric,
  prior_price_normalized numeric,
  prior_price_usd numeric,
  prior_currency_original text,
  prior_currency_normalized text,
  prior_currency_evidence text,
  prior_price_lane text,
  PRIMARY KEY(run_key,listing_id)
);

CREATE INDEX idx_qnsa_four_brand_source_completion_run
  ON public.qnsa_four_brand_source_completion_proposals(run_key,listing_id);

ALTER TABLE public.qnsa_four_brand_source_completion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_source_completion_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_source_completion_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qnsa_four_brand_source_completion_runs,
  public.qnsa_four_brand_source_completion_proposals,
  public.qnsa_four_brand_source_completion_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.qnsa_four_brand_source_completion_runs,
  public.qnsa_four_brand_source_completion_proposals,
  public.qnsa_four_brand_source_completion_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.begin_qnsa_four_brand_source_completion(
  p_run_key text,p_mode text,p_plan_sha256 text,p_expected_count integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF p_run_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{5,119}$'
    OR upper(p_mode) NOT IN ('CANARY','FULL') OR p_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_expected_count NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'Invalid source-completion run contract';
  END IF;
  INSERT INTO public.qnsa_four_brand_source_completion_runs(run_key,mode,plan_sha256,expected_count)
  VALUES(p_run_key,upper(p_mode),p_plan_sha256,p_expected_count);
  RETURN jsonb_build_object('run_key',p_run_key,'status','STAGING');
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_qnsa_four_brand_source_completion(
  p_run_key text,p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,extensions,pg_catalog AS $$
DECLARE r jsonb; l staging.listings%ROWTYPE; v_count integer:=0; v_mode text;
  v_canonical text; v_digest text; v_existing public.qnsa_four_brand_source_completion_proposals%ROWTYPE;
BEGIN
  SELECT mode INTO v_mode FROM public.qnsa_four_brand_source_completion_runs
    WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_mode IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  IF jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Each stage call requires 1..500 records';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    v_canonical:=r->>'proposal_canonical';
    v_digest:=encode(extensions.digest(convert_to(COALESCE(v_canonical,''),'UTF8'),'sha256'),'hex');
    IF v_canonical::jsonb IS DISTINCT FROM r-'proposal_canonical'-'proposal_sha256'
      OR v_digest IS DISTINCT FROM r->>'proposal_sha256' THEN
      RAISE EXCEPTION 'Proposal canonical digest mismatch';
    END IF;
    SELECT * INTO l FROM staging.listings WHERE id=(r->>'listing_id')::uuid;
    IF NOT FOUND OR l.brand_normalized IS DISTINCT FROM r->>'canonical_brand'
      OR l.raw_message_version_id IS DISTINCT FROM (r->>'raw_message_version_id')::uuid
      OR l.source_record_id IS DISTINCT FROM r->>'source_record_id'
      OR l.source_hash IS DISTINCT FROM r->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM r->>'source_candidate_hash'
      OR l.source_record_id IS DISTINCT FROM 'mysql_auctions_'||(r->>'source_auction_id')
      OR l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
      OR COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')<>'SINGLE_CANDIDATE'
      OR upper(COALESCE(l.listing_type,l.intent,'')) NOT IN ('WTS','WTB')
      OR NOT EXISTS(SELECT 1 FROM public.raw_message_versions rv WHERE rv.id=l.raw_message_version_id
        AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash) THEN
      RAISE EXCEPTION 'Exact single-listing lineage mismatch for %',r->>'listing_id';
    END IF;
    IF r ? 'proposed_image_url' THEN
      IF NULLIF(btrim(COALESCE(l.image_url,'')),'') IS NOT NULL
        OR (NULLIF(btrim(COALESCE(l.source_media_url_candidate,'')),'') IS NOT NULL
          AND l.source_media_url_candidate IS DISTINCT FROM r->>'proposed_image_url')
        OR r->>'proposed_image_url' !~ '^https://thecollective-prod\.nyc3\.digitaloceanspaces\.com/listings/full/[^[:space:]]+$'
        OR r->>'source_media_sha256' IS DISTINCT FROM
          encode(extensions.digest(convert_to(r->>'source_media_key','UTF8'),'sha256'),'hex') THEN
        RAISE EXCEPTION 'Image is not blank or exact media binding is invalid for %',l.id;
      END IF;
    END IF;
    IF r ? 'proposed_price_usd' THEN
      IF upper(COALESCE(l.listing_type,l.intent,''))<>'WTS'
        OR COALESCE(l.price_usd,l.price_normalized,0)>0
        OR (r->>'proposed_price_usd')::numeric<=0
        OR strpos(COALESCE(l.raw_message_text,''),r->>'price_evidence_quote')=0 THEN
        RAISE EXCEPTION 'Price is not missing or exact raw evidence is invalid for %',l.id;
      END IF;
      IF r->>'price_evidence_status'='SOURCE_EXPLICIT_USD_USDT' AND NOT (
        upper(r->>'source_currency') IN ('USD','USDT')
        AND abs((r->>'source_price_amount')::numeric-(r->>'proposed_price_usd')::numeric)<=0.01) THEN
        RAISE EXCEPTION 'Explicit USD binding mismatch';
      ELSIF r->>'price_evidence_status'='OWNER_ASSUMED_USD' AND
        NULLIF(btrim(COALESCE(r->>'source_currency','')),'') IS NOT NULL THEN
        RAISE EXCEPTION 'Owner-assumed price cannot have named currency';
      ELSIF r->>'price_evidence_status'='DATED_VERIFIED_FX' AND NOT (
        (r->>'fx_rate')::numeric>0 AND NULLIF(r->>'fx_source','') IS NOT NULL
        AND NULLIF(r->>'fx_date','') IS NOT NULL
        AND abs(round((r->>'source_price_amount')::numeric*(r->>'fx_rate')::numeric,2)
          -(r->>'proposed_price_usd')::numeric)<=0.01) THEN
        RAISE EXCEPTION 'Dated FX binding mismatch';
      END IF;
    END IF;
    INSERT INTO public.qnsa_four_brand_source_completion_proposals(
      run_key,listing_id,canonical_brand,raw_message_version_id,source_record_id,source_hash,
      source_candidate_hash,source_auction_id,proposed_image_url,source_media_key,
      source_media_sha256,image_verified_at,proposed_price_usd,source_price_amount,
      source_currency,price_evidence_status,fx_rate,fx_source,fx_date,price_evidence_quote,proposal_sha256
    ) VALUES(p_run_key,(r->>'listing_id')::uuid,r->>'canonical_brand',
      (r->>'raw_message_version_id')::uuid,r->>'source_record_id',r->>'source_hash',
      r->>'source_candidate_hash',(r->>'source_auction_id')::uuid,
      NULLIF(r->>'proposed_image_url',''),NULLIF(r->>'source_media_key',''),
      NULLIF(r->>'source_media_sha256',''),NULLIF(r->>'image_verified_at','')::timestamptz,
      NULLIF(r->>'proposed_price_usd','')::numeric,NULLIF(r->>'source_price_amount','')::numeric,
      NULLIF(r->>'source_currency',''),NULLIF(r->>'price_evidence_status',''),
      NULLIF(r->>'fx_rate','')::numeric,NULLIF(r->>'fx_source',''),NULLIF(r->>'fx_date','')::date,
      NULLIF(r->>'price_evidence_quote',''),r->>'proposal_sha256')
    ON CONFLICT(run_key,listing_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_existing FROM public.qnsa_four_brand_source_completion_proposals
        WHERE run_key=p_run_key AND listing_id=(r->>'listing_id')::uuid;
      IF v_existing.proposal_sha256 IS DISTINCT FROM r->>'proposal_sha256' THEN
        RAISE EXCEPTION 'Conflicting replay for %',r->>'listing_id';
      END IF;
    END IF;
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('staged',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_qnsa_four_brand_source_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_expected integer; v_actual integer;
BEGIN
  SELECT expected_count INTO v_expected FROM public.qnsa_four_brand_source_completion_runs
    WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  SELECT count(*) INTO v_actual FROM public.qnsa_four_brand_source_completion_proposals WHERE run_key=p_run_key;
  IF v_actual<>v_expected THEN RAISE EXCEPTION 'Staged % but expected %',v_actual,v_expected; END IF;
  UPDATE public.qnsa_four_brand_source_completion_runs SET status='STAGED',updated_at=now()
    WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'staged',v_actual);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_qnsa_four_brand_source_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,pg_catalog
SET statement_timeout='180s' AS $$
DECLARE v_expected integer; v_invalid integer; v_updated integer; v_mode text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('qnsa_four_brand_source_completion'));
  SELECT expected_count,mode INTO v_expected,v_mode FROM public.qnsa_four_brand_source_completion_runs
    WHERE run_key=p_run_key AND status='STAGED' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staged'; END IF;
  SELECT count(*) INTO v_invalid FROM public.qnsa_four_brand_source_completion_proposals p
  LEFT JOIN staging.listings l ON l.id=p.listing_id AND l.raw_message_version_id=p.raw_message_version_id
    AND l.source_record_id=p.source_record_id AND l.source_hash=p.source_hash
    AND l.source_candidate_hash=p.source_candidate_hash AND l.brand_normalized=p.canonical_brand
  WHERE p.run_key=p_run_key AND (l.id IS NULL OR l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
    OR (p.proposed_image_url IS NOT NULL AND (
      NULLIF(btrim(COALESCE(l.image_url,'')),'') IS NOT NULL
      OR (NULLIF(btrim(COALESCE(l.source_media_url_candidate,'')),'') IS NOT NULL
        AND l.source_media_url_candidate IS DISTINCT FROM p.proposed_image_url)
    ))
    OR (p.proposed_price_usd IS NOT NULL AND (upper(COALESCE(l.listing_type,l.intent,''))<>'WTS'
      OR COALESCE(l.price_usd,l.price_normalized,0)>0)));
  IF v_invalid<>0 THEN RAISE EXCEPTION 'Activation revalidation failed for % rows',v_invalid; END IF;

  INSERT INTO public.qnsa_four_brand_source_completion_snapshots(
    run_key,listing_id,prior_image_url,prior_source_media_key,prior_source_media_url_candidate,
    prior_public_image_eligible,prior_price_original,prior_price_normalized,prior_price_usd,
    prior_currency_original,prior_currency_normalized,prior_currency_evidence,prior_price_lane)
  SELECT p_run_key,l.id,l.image_url,l.source_media_key,l.source_media_url_candidate,l.public_image_eligible,
    l.price_original,l.price_normalized,l.price_usd,l.currency_original,l.currency_normalized,l.currency_evidence,
    COALESCE(om.price_lane,cm.price_lane,tm.price_lane)
  FROM public.qnsa_four_brand_source_completion_proposals p JOIN staging.listings l ON l.id=p.listing_id
  LEFT JOIN public.qnsa_omega_release_manifest om ON p.canonical_brand='Omega' AND om.listing_id=l.id
  LEFT JOIN public.qnsa_cartier_release_manifest cm ON p.canonical_brand='Cartier' AND cm.listing_id=l.id
  LEFT JOIN public.qnsa_tudor_release_manifest tm ON p.canonical_brand='Tudor' AND tm.listing_id=l.id
  WHERE p.run_key=p_run_key;

  UPDATE staging.listings l SET
    image_url=COALESCE(p.proposed_image_url,l.image_url),
    source_media_key=COALESCE(p.source_media_key,l.source_media_key),
    source_media_url_candidate=COALESCE(p.proposed_image_url,l.source_media_url_candidate),
    public_image_eligible=CASE WHEN p.proposed_image_url IS NOT NULL THEN true ELSE l.public_image_eligible END,
    price_original=COALESCE(p.source_price_amount,l.price_original),
    price_normalized=COALESCE(p.proposed_price_usd,l.price_normalized),
    price_usd=COALESCE(p.proposed_price_usd,l.price_usd),
    currency_original=CASE WHEN p.proposed_price_usd IS NULL THEN l.currency_original
      ELSE p.source_currency END,
    currency_normalized=CASE WHEN p.proposed_price_usd IS NULL THEN l.currency_normalized ELSE 'USD' END,
    currency_evidence=COALESCE(p.price_evidence_status,l.currency_evidence)
  FROM public.qnsa_four_brand_source_completion_proposals p
  WHERE p.run_key=p_run_key AND l.id=p.listing_id;
  GET DIAGNOSTICS v_updated=ROW_COUNT;

  UPDATE public.qnsa_omega_release_manifest m SET price_lane=
    CASE p.price_evidence_status WHEN 'OWNER_ASSUMED_USD' THEN 'OWNER_ASSUMED_USD_CANDIDATE'
      ELSE p.price_evidence_status END
  FROM public.qnsa_four_brand_source_completion_proposals p
  WHERE p.run_key=p_run_key AND p.canonical_brand='Omega' AND p.proposed_price_usd IS NOT NULL
    AND m.listing_id=p.listing_id;
  UPDATE public.qnsa_cartier_release_manifest m SET price_lane=
    CASE p.price_evidence_status WHEN 'OWNER_ASSUMED_USD' THEN 'OWNER_ASSUMED_USD_CANDIDATE'
      ELSE p.price_evidence_status END
  FROM public.qnsa_four_brand_source_completion_proposals p
  WHERE p.run_key=p_run_key AND p.canonical_brand='Cartier' AND p.proposed_price_usd IS NOT NULL
    AND m.listing_id=p.listing_id;
  UPDATE public.qnsa_tudor_release_manifest m SET price_lane=
    CASE p.price_evidence_status WHEN 'OWNER_ASSUMED_USD' THEN 'OWNER_ASSUMED_USD_CANDIDATE'
      ELSE p.price_evidence_status END
  FROM public.qnsa_four_brand_source_completion_proposals p
  WHERE p.run_key=p_run_key AND p.canonical_brand='Tudor' AND p.proposed_price_usd IS NOT NULL
    AND m.listing_id=p.listing_id;

  IF v_updated<>v_expected THEN RAISE EXCEPTION 'Updated % but expected %',v_updated,v_expected; END IF;
  UPDATE public.qnsa_four_brand_source_completion_runs SET status='ACTIVE',updated_at=now()
    WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'mode',v_mode,'updated',v_updated,'active',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_qnsa_four_brand_source_completion(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,pg_catalog
SET statement_timeout='180s' AS $$
DECLARE v_expected integer; v_restored integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('qnsa_four_brand_source_completion'));
  SELECT expected_count INTO v_expected FROM public.qnsa_four_brand_source_completion_runs
    WHERE run_key=p_run_key AND status='ACTIVE' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not active'; END IF;
  UPDATE staging.listings l SET image_url=s.prior_image_url,source_media_key=s.prior_source_media_key,
    source_media_url_candidate=s.prior_source_media_url_candidate,
    public_image_eligible=s.prior_public_image_eligible,price_original=s.prior_price_original,
    price_normalized=s.prior_price_normalized,price_usd=s.prior_price_usd,
    currency_original=s.prior_currency_original,currency_normalized=s.prior_currency_normalized,
    currency_evidence=s.prior_currency_evidence
  FROM public.qnsa_four_brand_source_completion_snapshots s
  WHERE s.run_key=p_run_key AND l.id=s.listing_id;
  GET DIAGNOSTICS v_restored=ROW_COUNT;
  UPDATE public.qnsa_omega_release_manifest m SET price_lane=s.prior_price_lane
    FROM public.qnsa_four_brand_source_completion_snapshots s
    WHERE s.run_key=p_run_key AND s.prior_price_lane IS NOT NULL AND m.listing_id=s.listing_id;
  UPDATE public.qnsa_cartier_release_manifest m SET price_lane=s.prior_price_lane
    FROM public.qnsa_four_brand_source_completion_snapshots s
    WHERE s.run_key=p_run_key AND s.prior_price_lane IS NOT NULL AND m.listing_id=s.listing_id;
  UPDATE public.qnsa_tudor_release_manifest m SET price_lane=s.prior_price_lane
    FROM public.qnsa_four_brand_source_completion_snapshots s
    WHERE s.run_key=p_run_key AND s.prior_price_lane IS NOT NULL AND m.listing_id=s.listing_id;
  IF v_restored<>v_expected THEN RAISE EXCEPTION 'Restored % but expected %',v_restored,v_expected; END IF;
  UPDATE public.qnsa_four_brand_source_completion_runs SET status='ROLLED_BACK',updated_at=now()
    WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'restored',v_restored,'rolled_back',true);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_qnsa_four_brand_source_completion(text,text,text,integer),
  public.stage_qnsa_four_brand_source_completion(text,jsonb),
  public.finalize_qnsa_four_brand_source_completion(text),
  public.activate_qnsa_four_brand_source_completion(text),
  public.rollback_qnsa_four_brand_source_completion(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_qnsa_four_brand_source_completion(text,text,text,integer),
  public.stage_qnsa_four_brand_source_completion(text,jsonb),
  public.finalize_qnsa_four_brand_source_completion(text),
  public.activate_qnsa_four_brand_source_completion(text),
  public.rollback_qnsa_four_brand_source_completion(text) TO service_role;

COMMIT;
