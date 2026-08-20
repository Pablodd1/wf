-- Missing-field enrichment for Tudor, Omega, Cartier and Zenith only.
-- Immutable staging/raw rows are never updated. Customer APIs consume the
-- active sidecar through qnsa_four_brand_effective_page_rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_runs (
  run_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('AUDIT','CANARY','FULL')),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  expected_count integer NOT NULL CHECK (expected_count BETWEEN 1 AND 50000),
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

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_active (
  listing_id uuid PRIMARY KEY,
  run_key text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_key, listing_id)
    REFERENCES public.qnsa_four_brand_enrichment_proposals(run_key, listing_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.qnsa_four_brand_enrichment_rollback_ledger (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_key text NOT NULL REFERENCES public.qnsa_four_brand_enrichment_runs(run_key),
  listing_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ACTIVATE','ROLLBACK')),
  proposal_snapshot jsonb NOT NULL,
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
ALTER TABLE public.qnsa_four_brand_enrichment_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_four_brand_enrichment_rollback_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qnsa_four_brand_enrichment_runs,
  public.qnsa_four_brand_enrichment_proposals,
  public.qnsa_four_brand_enrichment_active,
  public.qnsa_four_brand_enrichment_rollback_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qnsa_four_brand_enrichment_runs,
  public.qnsa_four_brand_enrichment_proposals,
  public.qnsa_four_brand_enrichment_active,
  public.qnsa_four_brand_enrichment_rollback_ledger TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.qnsa_four_brand_value_missing(p_field text, p_value text, p_brand text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(btrim(COALESCE(p_value,'')), '') IS NULL
    OR lower(btrim(COALESCE(p_value,''))) IN (
      'unknown','unspecified','not specified','not provided','reference only',
      'model not specified','dial not specified','condition not specified',lower(btrim(COALESCE(p_brand,'')))
    );
$$;

CREATE OR REPLACE FUNCTION public.begin_qnsa_four_brand_enrichment(
  p_run_key text, p_mode text, p_plan_sha256 text, p_expected_count integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NULLIF(btrim(p_run_key),'') IS NULL OR p_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR upper(p_mode) NOT IN ('AUDIT','CANARY','FULL')
    OR p_expected_count NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'Invalid four-brand enrichment run contract';
  END IF;
  INSERT INTO public.qnsa_four_brand_enrichment_runs(run_key,mode,plan_sha256,expected_count)
  VALUES (btrim(p_run_key),upper(p_mode),p_plan_sha256,p_expected_count);
  RETURN jsonb_build_object('run_key',btrim(p_run_key),'status','STAGING','expected_count',p_expected_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_qnsa_four_brand_enrichment(
  p_run_key text, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,extensions,pg_catalog AS $$
DECLARE
  r jsonb; l staging.listings%ROWTYPE; v_mode text; v_count integer := 0;
  v_evidence jsonb; v_evidence_text text; v_evidence_sha text;
BEGIN
  SELECT mode INTO v_mode FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_mode IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Each staging call requires 1..500 records';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    SELECT * INTO l FROM staging.listings WHERE id=(r->>'listing_id')::uuid FOR SHARE;
    IF NOT FOUND OR l.brand_normalized NOT IN ('Tudor','Omega','Cartier','Zenith')
      OR l.brand_normalized <> r->>'canonical_brand'
      OR l.raw_message_version_id IS DISTINCT FROM (r->>'raw_message_version_id')::uuid
      OR l.source_record_id IS DISTINCT FROM r->>'source_record_id'
      OR l.source_hash IS DISTINCT FROM r->>'source_hash'
      OR l.source_candidate_hash IS DISTINCT FROM r->>'source_candidate_hash'
      OR NOT EXISTS (SELECT 1 FROM public.raw_message_versions rv
        WHERE rv.id=l.raw_message_version_id AND rv.source_record_id=l.source_record_id
          AND rv.source_hash=l.source_hash) THEN
      RAISE EXCEPTION 'Private exact lineage mismatch for listing %',r->>'listing_id';
    END IF;
    IF l.parent_id IS NOT NULL OR COALESCE(l.is_bundle,false)
      OR upper(COALESCE(l.listing_type,l.intent,'')) NOT IN ('WTS','WTB') THEN
      RAISE EXCEPTION 'Only released individual WTS/WTB watches may be enriched';
    END IF;

    v_evidence := COALESCE(r->'evidence','{}'::jsonb);
    v_evidence_text := v_evidence::text;
    v_evidence_sha := encode(extensions.digest(convert_to(v_evidence_text,'UTF8'),'sha256'),'hex');
    IF NULLIF(r->>'evidence_sha256','') IS NOT NULL
      AND v_evidence_sha IS DISTINCT FROM r->>'evidence_sha256' THEN
      RAISE EXCEPTION 'Evidence digest mismatch for listing %',l.id;
    END IF;
    IF r ? 'proposed_model' AND NOT public.qnsa_four_brand_value_missing('model',l.model_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Model is not missing for listing %',l.id; END IF;
    IF r ? 'proposed_reference' AND NULLIF(btrim(COALESCE(l.reference_normalized,'')),'') IS NOT NULL
      THEN RAISE EXCEPTION 'Reference is not missing for listing %',l.id; END IF;
    IF r ? 'proposed_dial_color' AND NOT public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Dial is not missing for listing %',l.id; END IF;
    IF r ? 'proposed_condition' AND NOT public.qnsa_four_brand_value_missing('condition',l.condition_normalized,l.brand_normalized)
      THEN RAISE EXCEPTION 'Condition is not missing for listing %',l.id; END IF;
    IF r ? 'proposed_price_usd' AND (COALESCE(l.price_usd,0)>0 OR COALESCE(l.price_normalized,0)>0)
      THEN RAISE EXCEPTION 'Price is not missing for listing %',l.id; END IF;
    IF r ? 'proposed_price_usd' AND upper(COALESCE(l.listing_type,l.intent,'')) <> 'WTS'
      THEN RAISE EXCEPTION 'Price enrichment is WTS-only'; END IF;
    IF r ? 'proposed_image_url' OR r ? 'dealer_id' OR r ? 'dealer_rating' THEN
      RAISE EXCEPTION 'Images and dealers require their exact dedicated ledgers';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(v_evidence) e
      WHERE e.key LIKE '%_quote' AND NULLIF(e.value,'') IS NOT NULL
        AND strpos(COALESCE(l.raw_message_text,''),e.value)=0
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_each_text(v_evidence) e
      WHERE e.key LIKE '%_quote' AND NULLIF(e.value,'') IS NOT NULL
    ) THEN RAISE EXCEPTION 'Every proposal needs an exact quote present in immutable raw text'; END IF;
    IF (r ? 'proposed_model' AND NULLIF(v_evidence->>'model_quote','') IS NULL)
      OR (r ? 'proposed_reference' AND NULLIF(v_evidence->>'reference_quote','') IS NULL)
      OR (r ? 'proposed_dial_color' AND NULLIF(v_evidence->>'dial_quote','') IS NULL)
      OR (r ? 'proposed_condition' AND NULLIF(v_evidence->>'condition_quote','') IS NULL)
      OR (r ? 'proposed_price_usd' AND NULLIF(v_evidence->>'price_quote','') IS NULL) THEN
      RAISE EXCEPTION 'Each proposed field requires its matching exact quote';
    END IF;

    INSERT INTO public.qnsa_four_brand_enrichment_proposals(
      run_key,listing_id,canonical_brand,raw_message_version_id,source_record_id,source_hash,
      source_candidate_hash,proposed_model,proposed_reference,proposed_dial_color,
      proposed_condition,proposed_price_usd,price_evidence_status,source_price_amount,
      source_currency,fx_rate,fx_source,fx_date,evidence,evidence_sha256
    ) VALUES (
      p_run_key,l.id,l.brand_normalized,l.raw_message_version_id,l.source_record_id,l.source_hash,
      l.source_candidate_hash,NULLIF(btrim(r->>'proposed_model'),''),NULLIF(btrim(r->>'proposed_reference'),''),
      NULLIF(btrim(r->>'proposed_dial_color'),''),NULLIF(btrim(r->>'proposed_condition'),''),
      NULLIF(r->>'proposed_price_usd','')::numeric,NULLIF(r->>'price_evidence_status',''),
      NULLIF(r->>'source_price_amount','')::numeric,NULLIF(btrim(r->>'source_currency'),''),
      NULLIF(r->>'fx_rate','')::numeric,NULLIF(btrim(r->>'fx_source'),''),NULLIF(r->>'fx_date','')::date,
      v_evidence,v_evidence_sha
    );
    v_count := v_count+1;
  END LOOP;
  UPDATE public.qnsa_four_brand_enrichment_runs SET updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'staged_in_call',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_qnsa_four_brand_enrichment_stage(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_expected integer; v_actual integer;
BEGIN
  SELECT expected_count INTO v_expected FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status='STAGING' FOR UPDATE;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'Run is absent or not staging'; END IF;
  SELECT count(*) INTO v_actual FROM public.qnsa_four_brand_enrichment_proposals WHERE run_key=p_run_key;
  IF v_actual <> v_expected THEN RAISE EXCEPTION 'Staged % but expected %',v_actual,v_expected; END IF;
  UPDATE public.qnsa_four_brand_enrichment_runs SET status='STAGED',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'status','STAGED','count',v_actual);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_qnsa_four_brand_enrichment(
  p_run_key text, p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_mode text; v_limit integer; v_activated integer; v_active_total integer;
BEGIN
  SELECT mode INTO v_mode FROM public.qnsa_four_brand_enrichment_runs
  WHERE run_key=p_run_key AND status IN ('STAGED','CANARY_ACTIVE','FULL_ACTIVE') FOR UPDATE;
  IF v_mode IS NULL OR v_mode='AUDIT' THEN RAISE EXCEPTION 'Audit runs cannot activate'; END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit,0),1),CASE WHEN v_mode='CANARY' THEN 25 ELSE 500 END);
  WITH candidates AS (
    SELECT p.* FROM public.qnsa_four_brand_enrichment_proposals p
    JOIN staging.listings l ON l.id=p.listing_id AND l.raw_message_version_id=p.raw_message_version_id
      AND l.source_record_id=p.source_record_id AND l.source_hash=p.source_hash
      AND l.source_candidate_hash=p.source_candidate_hash AND l.brand_normalized=p.canonical_brand
    LEFT JOIN public.qnsa_four_brand_enrichment_active a ON a.listing_id=p.listing_id
    WHERE p.run_key=p_run_key AND a.listing_id IS NULL
      AND (p.proposed_model IS NULL OR public.qnsa_four_brand_value_missing('model',l.model_normalized,l.brand_normalized))
      AND (p.proposed_reference IS NULL OR NULLIF(btrim(COALESCE(l.reference_normalized,'')),'') IS NULL)
      AND (p.proposed_dial_color IS NULL OR public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,l.brand_normalized))
      AND (p.proposed_condition IS NULL OR public.qnsa_four_brand_value_missing('condition',l.condition_normalized,l.brand_normalized))
      AND (p.proposed_price_usd IS NULL OR (COALESCE(l.price_usd,0)<=0 AND COALESCE(l.price_normalized,0)<=0
        AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'))
    ORDER BY p.listing_id LIMIT v_limit
  ), activated AS (
    INSERT INTO public.qnsa_four_brand_enrichment_active(listing_id,run_key)
    SELECT listing_id,run_key FROM candidates RETURNING listing_id,run_key
  ), logged AS (
    INSERT INTO public.qnsa_four_brand_enrichment_rollback_ledger(run_key,listing_id,action,proposal_snapshot)
    SELECT a.run_key,a.listing_id,'ACTIVATE',to_jsonb(p) FROM activated a
    JOIN public.qnsa_four_brand_enrichment_proposals p USING(run_key,listing_id) RETURNING 1
  ) SELECT count(*) INTO v_activated FROM activated;
  UPDATE public.qnsa_four_brand_enrichment_runs SET
    status=CASE WHEN v_mode='CANARY' THEN 'CANARY_ACTIVE' ELSE 'FULL_ACTIVE' END,updated_at=now()
  WHERE run_key=p_run_key;
  SELECT count(*) INTO v_active_total FROM public.qnsa_four_brand_enrichment_active WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'activated_in_call',v_activated,
    'active_total',v_active_total,'mode',v_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_qnsa_four_brand_enrichment(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_count integer;
BEGIN
  WITH removed AS (
    DELETE FROM public.qnsa_four_brand_enrichment_active WHERE run_key=p_run_key
    RETURNING listing_id,run_key
  ), logged AS (
    INSERT INTO public.qnsa_four_brand_enrichment_rollback_ledger(run_key,listing_id,action,proposal_snapshot)
    SELECT r.run_key,r.listing_id,'ROLLBACK',to_jsonb(p) FROM removed r
    JOIN public.qnsa_four_brand_enrichment_proposals p USING(run_key,listing_id) RETURNING 1
  ) SELECT count(*) INTO v_count FROM removed;
  UPDATE public.qnsa_four_brand_enrichment_runs SET status='ROLLED_BACK',updated_at=now() WHERE run_key=p_run_key;
  RETURN jsonb_build_object('run_key',p_run_key,'rolled_back',v_count);
END;
$$;

CREATE OR REPLACE VIEW public.qnsa_four_brand_effective_enrichment
WITH (security_invoker=true) AS
SELECT p.* FROM public.qnsa_four_brand_enrichment_active a
JOIN public.qnsa_four_brand_enrichment_proposals p USING(run_key,listing_id);

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
  FROM public.qnsa_four_brand_enrichment_active a
  JOIN public.qnsa_four_brand_enrichment_proposals p USING(run_key,listing_id)
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
  p_condition text DEFAULT NULL, p_search text DEFAULT NULL
) RETURNS TABLE(row_data jsonb) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
  WITH released AS MATERIALIZED (
    SELECT 'Omega'::text brand,m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_omega_release_control c JOIN public.qnsa_omega_release_manifest m
      ON m.release_run_key=c.release_run_key
    WHERE btrim(p_brand)='Omega' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Cartier',m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_cartier_release_control c JOIN public.qnsa_cartier_release_manifest m
      ON m.release_run_key=c.release_run_key
    WHERE btrim(p_brand)='Cartier' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Tudor',m.listing_id,m.release_order,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_tudor_release_control c JOIN public.qnsa_tudor_release_manifest m
      ON m.release_run_key=c.release_run_key
    WHERE btrim(p_brand)='Tudor' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Zenith',l.id,
      row_number() OVER (ORDER BY
        EXISTS (SELECT 1 FROM public.listing_image_reviews ir
          WHERE ir.record_id=l.id::text AND ir.status='VISUALLY_VERIFIED') DESC,
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
    WHERE btrim(p_brand)='Zenith'
  ), source_rows AS MATERIALIZED (
    SELECT r.brand,r.release_order,r.public_model,r.public_reference,r.catalog_reference_confirmed,
      r.price_lane,l.id,l.source_record_id,l.created_at,l.user_name,l.from_name,l.raw_message_text,
      l.brand_original,l.reference_original,l.dial_color_normalized,l.condition_normalized,
      l.price_usd,l.price_normalized,l.currency_normalized,l.overall_confidence,l.verdict,l.location,
      upper(COALESCE(l.listing_type,l.intent,'')) effective_intent,
      p.proposed_model,p.proposed_reference,p.proposed_dial_color,p.proposed_condition,
      p.proposed_price_usd,p.price_evidence_status proposed_price_status,
      p.source_price_amount proposed_source_amount,p.source_currency proposed_source_currency,
      p.fx_rate proposed_fx_rate,p.fx_source proposed_fx_source,p.fx_date proposed_fx_date,
      p.run_key field_enrichment_run_key,
      dl.dealer_id exact_dealer_id,
      mm.public_url verified_image_url
    FROM released r JOIN staging.listings l ON l.id=r.listing_id
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    LEFT JOIN public.qnsa_four_brand_enrichment_active a ON a.listing_id=l.id
    LEFT JOIN public.qnsa_four_brand_enrichment_proposals p ON p.run_key=a.run_key AND p.listing_id=a.listing_id
      AND p.raw_message_version_id=l.raw_message_version_id AND p.source_record_id=l.source_record_id
      AND p.source_hash=l.source_hash AND p.source_candidate_hash=l.source_candidate_hash
      AND p.canonical_brand=l.brand_normalized
    LEFT JOIN public.dealer_listing_links dl ON dl.listing_id=l.id AND dl.link_status='APPLIED'
    LEFT JOIN LATERAL (
      SELECT mm.public_url FROM public.listing_image_reviews ir
      JOIN public.media_manifest mm ON mm.source_object_key=ir.source_object_key
        AND mm.matched_record_id=l.id::text AND mm.verification_status='url_reachable'
      WHERE ir.record_id=l.id::text AND ir.status='VISUALLY_VERIFIED'
      ORDER BY ir.reviewed_at DESC NULLS LAST,ir.source_object_key LIMIT 1
    ) mm ON true
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
  ), effective AS MATERIALIZED (
    SELECT s.*,
      CASE WHEN public.qnsa_four_brand_value_missing('model',s.public_model,s.brand)
        THEN COALESCE(s.proposed_model,s.public_model) ELSE s.public_model END effective_model,
      COALESCE(NULLIF(btrim(s.public_reference),''),s.proposed_reference) effective_reference,
      CASE WHEN public.qnsa_four_brand_value_missing('dial',s.dial_color_normalized,s.brand)
        THEN COALESCE(s.proposed_dial_color,s.dial_color_normalized) ELSE s.dial_color_normalized END effective_dial,
      CASE WHEN public.qnsa_four_brand_value_missing('condition',s.condition_normalized,s.brand)
        THEN COALESCE(s.proposed_condition,s.condition_normalized) ELSE s.condition_normalized END effective_condition
    FROM source_rows s
  ), selected AS MATERIALIZED (
    SELECT * FROM effective e
    WHERE (p_model IS NULL OR lower(btrim(COALESCE(e.effective_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(e.effective_reference,'')),'[^A-Z0-9]','','g')
        =regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_dial IS NULL OR lower(btrim(COALESCE(e.effective_dial,'')))=lower(btrim(p_dial)))
      AND (p_condition IS NULL OR lower(btrim(COALESCE(e.effective_condition,'')))=lower(btrim(p_condition)))
      AND (p_search IS NULL OR concat_ws(' ',e.brand,e.effective_model,e.effective_reference,e.effective_dial,
        e.effective_condition,e.raw_message_text,e.user_name,e.from_name) ILIKE '%'||p_search||'%')
    ORDER BY e.release_order
    LIMIT LEAST(GREATEST(COALESCE(p_limit,51),1),101)
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
    'catalog_reference',CASE WHEN s.catalog_reference_confirmed THEN s.effective_reference END,
    'catalog_reference_confirmed',s.catalog_reference_confirmed,
    'dial_color',s.effective_dial,'catalog_dial',s.effective_dial,'condition',s.effective_condition,
    'workbook_price_usd',CASE
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
    'raw_lineage_verified',true,'dealer_id',s.exact_dealer_id,'dealer_rating',NULL,'review_count',NULL,
    'field_enrichment_run_key',s.field_enrichment_run_key,'analytics_fx_rate',s.proposed_fx_rate,
    'analytics_fx_source',s.proposed_fx_source,'analytics_fx_date',s.proposed_fx_date
  ) FROM selected s ORDER BY s.release_order;
$$;

REVOKE ALL ON FUNCTION public.qnsa_four_brand_value_missing(text,text,text),
  public.begin_qnsa_four_brand_enrichment(text,text,text,integer),
  public.stage_qnsa_four_brand_enrichment(text,jsonb),
  public.finalize_qnsa_four_brand_enrichment_stage(text),
  public.activate_qnsa_four_brand_enrichment(text,integer),
  public.rollback_qnsa_four_brand_enrichment(text),
  public.qnsa_four_brand_effective_enrichments(uuid[]),
  public.qnsa_four_brand_effective_page_rows(text,integer,integer,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_four_brand_value_missing(text,text,text),
  public.begin_qnsa_four_brand_enrichment(text,text,text,integer),
  public.stage_qnsa_four_brand_enrichment(text,jsonb),
  public.finalize_qnsa_four_brand_enrichment_stage(text),
  public.activate_qnsa_four_brand_enrichment(text,integer),
  public.rollback_qnsa_four_brand_enrichment(text),
  public.qnsa_four_brand_effective_enrichments(uuid[]),
  public.qnsa_four_brand_effective_page_rows(text,integer,integer,text,text,text,text,text,text)
  TO service_role;
REVOKE ALL ON public.qnsa_four_brand_effective_enrichment FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.qnsa_four_brand_effective_enrichment TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
