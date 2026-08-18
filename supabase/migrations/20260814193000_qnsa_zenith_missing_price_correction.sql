-- Bounded exact-lineage correction for Zenith rows whose immutable source text
-- contains a deterministic price that the historical line parser missed.
-- Raw evidence, identity, listing cardinality, and publication decisions remain unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.qnsa_zenith_missing_price_correction_audit (
  correction_run_key TEXT NOT NULL,
  listing_id UUID NOT NULL,
  normalization_run_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  previous_price JSONB NOT NULL,
  corrected_price JSONB NOT NULL,
  fx_snapshot JSONB NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (correction_run_key,listing_id)
);
ALTER TABLE staging.qnsa_zenith_missing_price_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.qnsa_zenith_missing_price_correction_audit FROM PUBLIC,anon,authenticated;
GRANT ALL ON staging.qnsa_zenith_missing_price_correction_audit TO service_role;

CREATE OR REPLACE FUNCTION public.apply_qnsa_zenith_missing_price_correction(
  p_normalization_run_key TEXT,p_correction_run_key TEXT,p_fx_snapshot JSONB,p_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
DECLARE
  v_target_rows INTEGER;
  v_matched_rows INTEGER;
  v_audit_rows INTEGER;
  v_updated_rows INTEGER;
  v_verified_rows INTEGER;
BEGIN
  IF p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_correction_run_key !~ '^[A-Za-z0-9._:-]{1,100}$' THEN RAISE EXCEPTION 'invalid run key'; END IF;
  IF p_payload->>'contract' IS DISTINCT FROM 'qnsa-zenith-missing-price-correction-v1'
    OR p_fx_snapshot->>'contract' IS DISTINCT FROM 'wf-dated-fx-snapshot-v1'
    OR p_fx_snapshot->>'base' IS DISTINCT FROM 'USD'
    OR p_payload->>'fx_observed_at' IS DISTINCT FROM p_fx_snapshot->>'observed_at'
    OR p_payload->>'fx_source' IS DISTINCT FROM p_fx_snapshot->>'source' THEN
    RAISE EXCEPTION 'payload/FX contract mismatch';
  END IF;

  CREATE TEMP TABLE zenith_missing_price_targets ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(p_payload->'corrections') AS x(
    listing_id UUID,source_record_id TEXT,source_hash TEXT,listing_type TEXT,
    amount_original NUMERIC,currency_original TEXT,price_usd NUMERIC,
    conversion_rate NUMERIC,conversion_timestamp TIMESTAMPTZ,conversion_source TEXT,
    currency_evidence TEXT,raw_price_text TEXT
  );
  SELECT count(*) INTO v_target_rows FROM zenith_missing_price_targets;
  IF v_target_rows<1 OR v_target_rows>250 OR v_target_rows<>(SELECT count(DISTINCT listing_id) FROM zenith_missing_price_targets)
    OR v_target_rows<>(p_payload->>'corrected_rows')::integer THEN RAISE EXCEPTION 'invalid correction census'; END IF;
  IF EXISTS (SELECT 1 FROM zenith_missing_price_targets WHERE amount_original<=0 OR price_usd<=0
    OR conversion_rate<=0 OR currency_original NOT IN ('USD','USDT','EUR','HKD')
    OR NULLIF(btrim(source_record_id),'') IS NULL OR source_hash !~ '^[0-9a-f]{64}$'
    OR listing_type NOT IN ('WTS','WTB') OR NULLIF(btrim(raw_price_text),'') IS NULL) THEN
    RAISE EXCEPTION 'invalid correction evidence'; END IF;

  SELECT count(*) INTO v_matched_rows
  FROM zenith_missing_price_targets t
  JOIN staging.listings l ON l.id=t.listing_id AND l.normalization_run_key=p_normalization_run_key
    AND l.source_record_id=t.source_record_id AND l.source_hash=t.source_hash
  JOIN staging.qnsa_zenith_identity_reconciliation_audit a
    ON a.listing_id=l.id AND a.normalization_run_key=l.normalization_run_key
    AND a.reconciliation_run_key='zenith-identity-20260814-v1' AND a.decision='RELEASE_SAFE'
    AND a.corrected_reference=l.reference_normalized
  JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
    AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
  WHERE l.brand_normalized='Zenith' AND upper(COALESCE(l.category,''))='WATCH'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
    AND l.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type,l.intent,''))=t.listing_type
    AND (COALESCE(l.price_normalized,0)<=0 OR (l.price_normalized=t.amount_original
      AND l.currency_normalized=t.currency_original AND l.price_usd=t.price_usd))
    AND strpos(replace(COALESCE(l.raw_message_text,''),'💲','$'),t.raw_price_text)>0;
  IF v_matched_rows<>v_target_rows THEN RAISE EXCEPTION 'exact lineage or raw price evidence mismatch'; END IF;

  INSERT INTO staging.qnsa_zenith_missing_price_correction_audit(
    correction_run_key,listing_id,normalization_run_key,source_record_id,source_hash,
    previous_price,corrected_price,fx_snapshot)
  SELECT p_correction_run_key,l.id,l.normalization_run_key,l.source_record_id,l.source_hash,
    jsonb_build_object('amount',l.price_normalized,'currency',l.currency_normalized,'price_usd',l.price_usd,
      'rate',l.conversion_rate,'timestamp',l.conversion_timestamp,'source',l.conversion_source),
    jsonb_build_object('amount',t.amount_original,'currency',t.currency_original,'price_usd',t.price_usd,
      'rate',t.conversion_rate,'timestamp',t.conversion_timestamp,'source',t.conversion_source,
      'evidence',t.currency_evidence,'raw_price_text',t.raw_price_text),p_fx_snapshot
  FROM zenith_missing_price_targets t JOIN staging.listings l ON l.id=t.listing_id
  ON CONFLICT(correction_run_key,listing_id) DO NOTHING;
  GET DIAGNOSTICS v_audit_rows=ROW_COUNT;

  UPDATE staging.listings l SET price_normalized=t.amount_original,currency_normalized=t.currency_original,
    price_usd=t.price_usd,conversion_rate=t.conversion_rate,
    conversion_timestamp=t.conversion_timestamp,conversion_source=t.conversion_source,updated_at=now()
  FROM zenith_missing_price_targets t WHERE l.id=t.listing_id
    AND (l.price_normalized IS DISTINCT FROM t.amount_original OR l.currency_normalized IS DISTINCT FROM t.currency_original
      OR l.price_usd IS DISTINCT FROM t.price_usd OR l.conversion_rate IS DISTINCT FROM t.conversion_rate
      OR l.conversion_timestamp IS DISTINCT FROM t.conversion_timestamp OR l.conversion_source IS DISTINCT FROM t.conversion_source);
  GET DIAGNOSTICS v_updated_rows=ROW_COUNT;

  SELECT count(*) INTO v_verified_rows FROM zenith_missing_price_targets t JOIN staging.listings l ON l.id=t.listing_id
  WHERE l.price_normalized=t.amount_original AND l.currency_normalized=t.currency_original AND l.price_usd=t.price_usd
    AND l.conversion_rate=t.conversion_rate AND l.conversion_source=t.conversion_source;
  IF v_verified_rows<>v_target_rows OR v_audit_rows NOT IN (0,v_target_rows) THEN
    RAISE EXCEPTION 'correction reconciliation failed'; END IF;
  RETURN jsonb_build_object('target_rows',v_target_rows,'audit_rows_inserted',v_audit_rows,
    'rows_updated',v_updated_rows,'verified_rows',v_verified_rows,'staging_rows_created',0,'raw_rows_mutated',0);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_qnsa_zenith_missing_price_correction(TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qnsa_zenith_missing_price_correction(TEXT,TEXT,JSONB,JSONB)
  TO service_role,postgres,supabase_admin;

COMMIT;
