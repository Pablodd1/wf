-- Exact-lineage, price-only correction for the 464-row Zenith release cohort.
-- Immutable raw/version rows and listing cardinality are unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.qnsa_zenith_price_correction_audit (
  correction_run_key TEXT NOT NULL,
  listing_id UUID NOT NULL,
  normalization_run_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  previous_price JSONB NOT NULL,
  corrected_price JSONB NOT NULL,
  fx_snapshot JSONB NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (correction_run_key, listing_id)
);

ALTER TABLE staging.qnsa_zenith_price_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.qnsa_zenith_price_correction_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.qnsa_zenith_price_correction_audit TO service_role;

CREATE OR REPLACE FUNCTION public.apply_qnsa_zenith_price_correction(
  p_normalization_run_key TEXT,
  p_correction_run_key TEXT,
  p_fx_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_eur_rate NUMERIC;
  v_hkd_rate NUMERIC;
  v_target_rows BIGINT;
  v_inserted_rows BIGINT;
  v_updated_rows BIGINT;
  v_verified_rows BIGINT;
  v_staging_rows_before BIGINT;
  v_staging_rows_after BIGINT;
BEGIN
  IF p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_correction_run_key !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid run key';
  END IF;
  IF p_fx_snapshot->>'contract' IS DISTINCT FROM 'wf-dated-fx-snapshot-v1'
    OR p_fx_snapshot->>'base' IS DISTINCT FROM 'USD'
    OR NULLIF(p_fx_snapshot->>'source','') IS NULL
    OR NULLIF(p_fx_snapshot->>'observed_at','') IS NULL THEN
    RAISE EXCEPTION 'dated named USD FX snapshot is required';
  END IF;
  v_eur_rate := (p_fx_snapshot->'usd_per_unit'->>'EUR')::numeric;
  v_hkd_rate := (p_fx_snapshot->'usd_per_unit'->>'HKD')::numeric;
  IF COALESCE(v_eur_rate,0) <= 0 OR COALESCE(v_hkd_rate,0) <= 0
    OR (p_fx_snapshot->'usd_per_unit'->>'USD')::numeric IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'FX snapshot is missing EUR, HKD, or USD';
  END IF;
  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key=p_normalization_run_key AND status='NORMALIZATION_STAGED'
    AND error_rows=0 AND input_rows=staged_rows+existing_rows+deferred_rows;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization checkpoint is not reconciled'; END IF;

  SELECT count(*) INTO v_staging_rows_before FROM staging.listings;

  CREATE TEMP TABLE zenith_price_targets ON COMMIT DROP AS
  SELECT l.id,l.normalization_run_key,l.source_record_id,l.source_hash,
    l.price_normalized,l.currency_normalized,l.price_usd,l.conversion_rate,
    l.conversion_timestamp,l.conversion_source,
    CASE upper(COALESCE(l.currency_normalized,''))
      WHEN 'EUR' THEN v_eur_rate
      WHEN 'HKD' THEN v_hkd_rate
      WHEN '' THEN 1::numeric
    END AS new_rate,
    CASE WHEN NULLIF(btrim(COALESCE(l.currency_normalized,'')),'') IS NULL
      THEN 'USD' ELSE upper(l.currency_normalized) END AS new_currency,
    CASE WHEN NULLIF(btrim(COALESCE(l.currency_normalized,'')),'') IS NULL
      THEN 'USD_DEFAULTED_BY_POLICY' ELSE p_fx_snapshot->>'source' END AS new_source
  FROM staging.listings l
  JOIN public.raw_message_versions rv
    ON rv.id=l.raw_message_version_id
   AND rv.source_record_id=l.source_record_id
   AND rv.source_hash=l.source_hash
  WHERE l.normalization_run_key=p_normalization_run_key
    AND l.brand_normalized='Zenith'
    AND upper(COALESCE(l.category,''))='WATCH'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
    AND l.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'
    AND l.price_normalized>0
    AND upper(COALESCE(l.currency_normalized,'')) IN ('EUR','HKD','')
    AND l.source_hash ~ '^[0-9a-f]{64}$'
    AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED');

  IF EXISTS (
    SELECT 1 FROM staging.listings l
    WHERE l.normalization_run_key=p_normalization_run_key AND l.brand_normalized='Zenith'
      AND upper(COALESCE(l.listing_type,l.intent,''))='WTS' AND l.price_normalized>0
      AND upper(COALESCE(l.currency_normalized,'')) NOT IN ('EUR','HKD','')
  ) THEN RAISE EXCEPTION 'unsupported Zenith source currency is present'; END IF;

  SELECT count(*) INTO v_target_rows FROM zenith_price_targets;
  IF v_target_rows < 1 OR v_target_rows > 500 THEN RAISE EXCEPTION 'Zenith correction census is outside 1..500'; END IF;

  INSERT INTO staging.qnsa_zenith_price_correction_audit (
    correction_run_key,listing_id,normalization_run_key,source_record_id,source_hash,
    previous_price,corrected_price,fx_snapshot
  )
  SELECT p_correction_run_key,t.id,t.normalization_run_key,t.source_record_id,t.source_hash,
    jsonb_build_object('price_usd',t.price_usd,'currency',t.currency_normalized,
      'conversion_rate',t.conversion_rate,'conversion_timestamp',t.conversion_timestamp,
      'conversion_source',t.conversion_source),
    jsonb_build_object('source_amount',t.price_normalized,'price_usd',round(t.price_normalized*t.new_rate,2),
      'currency',t.new_currency,'conversion_rate',t.new_rate,
      'conversion_timestamp',p_fx_snapshot->>'observed_at','conversion_source',t.new_source),
    p_fx_snapshot
  FROM zenith_price_targets t
  ON CONFLICT (correction_run_key,listing_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;

  UPDATE staging.listings l
  SET price_usd=round(t.price_normalized*t.new_rate,2),
      currency_normalized=t.new_currency,
      conversion_rate=t.new_rate,
      conversion_timestamp=(p_fx_snapshot->>'observed_at')::timestamptz,
      conversion_source=t.new_source,
      updated_at=now()
  FROM zenith_price_targets t
  WHERE l.id=t.id
    AND (l.price_usd IS DISTINCT FROM round(t.price_normalized*t.new_rate,2)
      OR l.currency_normalized IS DISTINCT FROM t.new_currency
      OR l.conversion_rate IS DISTINCT FROM t.new_rate
      OR l.conversion_timestamp IS DISTINCT FROM (p_fx_snapshot->>'observed_at')::timestamptz
      OR l.conversion_source IS DISTINCT FROM t.new_source);
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  SELECT count(*) INTO v_verified_rows
  FROM staging.listings l JOIN zenith_price_targets t ON t.id=l.id
  WHERE l.price_usd>0 AND l.currency_normalized IN ('USD','EUR','HKD')
    AND l.conversion_rate>0 AND l.conversion_timestamp IS NOT NULL
    AND NULLIF(btrim(l.conversion_source),'') IS NOT NULL;
  SELECT count(*) INTO v_staging_rows_after FROM staging.listings;
  IF v_staging_rows_after <> v_staging_rows_before OR v_verified_rows <> v_target_rows THEN
    RAISE EXCEPTION 'Zenith price correction failed row or evidence reconciliation';
  END IF;
  RETURN jsonb_build_object(
    'correction_run_key',p_correction_run_key,'target_rows',v_target_rows,
    'audit_rows_inserted',v_inserted_rows,'rows_updated',v_updated_rows,
    'verified_rows',v_verified_rows,'staging_row_delta',v_staging_rows_after-v_staging_rows_before,
    'raw_rows_mutated',0,'fx_observed_at',p_fx_snapshot->>'observed_at',
    'fx_source',p_fx_snapshot->>'source'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_qnsa_zenith_price_correction(TEXT,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qnsa_zenith_price_correction(TEXT,TEXT,JSONB)
  TO service_role, postgres, supabase_admin;

COMMIT;
