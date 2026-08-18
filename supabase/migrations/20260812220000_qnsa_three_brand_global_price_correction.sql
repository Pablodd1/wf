-- Forward-only, resumable price-provenance repair for the completed QNSA
-- Rolex, Patek Philippe, and Audemars Piguet staging run.
--
-- This contract updates price fields on exact existing single-listing lineage.
-- It never inserts/deletes staging listings and never mutates immutable raw
-- payloads or raw message versions.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.mariadb_three_brand_price_correction_runs (
  correction_run_key TEXT PRIMARY KEY,
  normalization_run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL,
  fx_snapshot JSONB NOT NULL,
  supported_currencies TEXT[] NOT NULL,
  census_rows BIGINT NOT NULL CHECK (census_rows >= 0),
  initial_staging_rows BIGINT NOT NULL CHECK (initial_staging_rows >= 0),
  cursor_listing_id UUID,
  scanned_rows BIGINT NOT NULL DEFAULT 0,
  corrected_rows BIGINT NOT NULL DEFAULT 0,
  skipped_rows BIGINT NOT NULL DEFAULT 0,
  batch_sequence BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'RUNNING', 'COMPLETE')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (scanned_rows = corrected_rows + skipped_rows),
  CHECK (scanned_rows <= census_rows)
);

ALTER TABLE staging.mariadb_three_brand_price_correction_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.mariadb_three_brand_price_correction_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.mariadb_three_brand_price_correction_runs TO service_role;

CREATE INDEX IF NOT EXISTS idx_staging_three_brand_price_correction_cursor_20260812220000
  ON staging.listings (normalization_run_key, id)
  WHERE brand_normalized IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(listing_type, intent, '')) = 'WTS'
    AND NULLIF(btrim(reference_normalized), '') IS NOT NULL
    AND (
      COALESCE(price_usd, 0) <= 0
      OR (
        upper(COALESCE(currency_normalized, '')) NOT IN ('USD', 'USDT')
        AND (
          COALESCE(conversion_rate, 0) <= 0
          OR conversion_timestamp IS NULL
          OR NULLIF(btrim(conversion_source), '') IS NULL
        )
      )
    );

CREATE OR REPLACE FUNCTION public.start_mariadb_three_brand_price_correction(
  p_correction_run_key TEXT,
  p_normalization_run_key TEXT,
  p_policy_version TEXT,
  p_fx_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_required_currencies CONSTANT TEXT[] := ARRAY[
    'USD','EUR','HKD','GBP','CHF','CNY','JPY','SGD','KRW','THB','CAD','AUD',
    'NZD','MYR','IDR','INR','PHP','BRL','MXN','ZAR','SEK','NOK','DKK'
  ];
  v_census BIGINT;
  v_staging_rows BIGINT;
  v_run staging.mariadb_three_brand_price_correction_runs%ROWTYPE;
BEGIN
  IF p_correction_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_policy_version !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid correction, normalization, or policy key';
  END IF;
  IF p_fx_snapshot->>'contract' IS DISTINCT FROM 'wf-dated-fx-snapshot-v1'
    OR COALESCE(p_fx_snapshot->>'observed_at', '') = ''
    OR (p_fx_snapshot->>'observed_at')::timestamptz IS NULL
    OR COALESCE(p_fx_snapshot->>'source', '') = ''
    OR COALESCE(p_fx_snapshot->>'source_url', '') = ''
    OR p_fx_snapshot->>'base' IS DISTINCT FROM 'USD'
    OR p_fx_snapshot->'recognized_but_withheld' IS DISTINCT FROM '["AED","SAR","TWD","VND"]'::jsonb
    OR jsonb_typeof(p_fx_snapshot->'usd_per_unit') <> 'object' THEN
    RAISE EXCEPTION 'valid dated, named USD-per-unit FX snapshot is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_required_currencies) AS currency(code)
    WHERE COALESCE((p_fx_snapshot->'usd_per_unit'->>currency.code)::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'FX snapshot does not cover every supported currency';
  END IF;
  IF (p_fx_snapshot->'usd_per_unit'->>'USD')::numeric IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'FX snapshot USD rate must equal one';
  END IF;

  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_normalization_run_key
    AND status = 'NORMALIZATION_STAGED'
    AND error_rows = 0
    AND input_rows = staged_rows + existing_rows + deferred_rows;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization run is not complete and reconciled'; END IF;

  SELECT count(*) INTO v_staging_rows FROM staging.listings;
  SELECT count(*) INTO v_census
  FROM staging.listings AS listing
  JOIN public.raw_message_versions AS version
    ON version.id = listing.raw_message_version_id
   AND version.source_record_id = listing.source_record_id
   AND version.source_hash = listing.source_hash
  WHERE listing.normalization_run_key = p_normalization_run_key
    AND listing.brand_normalized IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
    AND upper(COALESCE(listing.category, '')) = 'WATCH'
    AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
    AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
    AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
    AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
    AND listing.source_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND (
      COALESCE(listing.price_usd, 0) <= 0
      OR (
        upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
        AND (COALESCE(listing.conversion_rate, 0) <= 0 OR listing.conversion_timestamp IS NULL
          OR NULLIF(btrim(listing.conversion_source), '') IS NULL)
      )
    );

  INSERT INTO staging.mariadb_three_brand_price_correction_runs (
    correction_run_key, normalization_run_key, policy_version, fx_snapshot,
    supported_currencies, census_rows, initial_staging_rows, status, completed_at
  ) VALUES (
    p_correction_run_key, p_normalization_run_key, p_policy_version, p_fx_snapshot,
    v_required_currencies, v_census, v_staging_rows,
    CASE WHEN v_census = 0 THEN 'COMPLETE' ELSE 'READY' END,
    CASE WHEN v_census = 0 THEN now() ELSE NULL END
  ) ON CONFLICT (correction_run_key) DO NOTHING;

  SELECT * INTO v_run FROM staging.mariadb_three_brand_price_correction_runs
  WHERE correction_run_key = p_correction_run_key;
  IF v_run.normalization_run_key <> p_normalization_run_key
    OR v_run.policy_version <> p_policy_version
    OR v_run.fx_snapshot IS DISTINCT FROM p_fx_snapshot
    OR v_run.supported_currencies IS DISTINCT FROM v_required_currencies THEN
    RAISE EXCEPTION 'correction run immutable configuration does not match';
  END IF;
  RETURN to_jsonb(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.qnsa_three_brand_price_correction_page(
  p_correction_run_key TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run staging.mariadb_three_brand_price_correction_runs%ROWTYPE;
  v_records JSONB;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'page limit must be between 1 and 500'; END IF;
  SELECT * INTO v_run FROM staging.mariadb_three_brand_price_correction_runs
  WHERE correction_run_key = p_correction_run_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction run does not exist'; END IF;
  IF v_run.status = 'COMPLETE' THEN
    RETURN to_jsonb(v_run) || jsonb_build_object('records', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(page.payload ORDER BY page.listing_id), '[]'::jsonb) INTO v_records
  FROM (
    SELECT listing.id AS listing_id,
      jsonb_build_object(
        'listing_id', listing.id,
        'source_record_id', listing.source_record_id,
        'source_hash', listing.source_hash,
        'canonical_brand', listing.brand_normalized,
        'normalized_reference', listing.reference_normalized,
        'raw_payload', version.raw_payload
      ) AS payload
    FROM staging.listings AS listing
    JOIN public.raw_message_versions AS version
      ON version.id = listing.raw_message_version_id
     AND version.source_record_id = listing.source_record_id
     AND version.source_hash = listing.source_hash
    WHERE listing.normalization_run_key = v_run.normalization_run_key
      AND listing.brand_normalized IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND (v_run.cursor_listing_id IS NULL OR listing.id > v_run.cursor_listing_id)
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (
        COALESCE(listing.price_usd, 0) <= 0
        OR (
          upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
          AND (COALESCE(listing.conversion_rate, 0) <= 0 OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL)
        )
      )
    ORDER BY listing.id
    LIMIT p_limit
  ) AS page;

  RETURN to_jsonb(v_run) || jsonb_build_object('previous_cursor', v_run.cursor_listing_id, 'records', v_records);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_mariadb_three_brand_price_policy_batch(
  p_correction_run_key TEXT,
  p_batch_token TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run staging.mariadb_three_brand_price_correction_runs%ROWTYPE;
  v_existing JSONB;
  v_input_rows INTEGER;
  v_match_rows INTEGER;
  v_updated_rows INTEGER;
  v_before_rows BIGINT;
  v_after_rows BIGINT;
  v_result JSONB;
BEGIN
  IF p_batch_token !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_records) <> 'array'
    OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'valid batch token and 1 to 500 records are required';
  END IF;
  v_input_rows := jsonb_array_length(p_records);
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_three_brand_price_policy:' || p_correction_run_key));
  SELECT * INTO v_run FROM staging.mariadb_three_brand_price_correction_runs
  WHERE correction_run_key = p_correction_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'COMPLETE' THEN RAISE EXCEPTION 'active correction run is required'; END IF;

  SELECT result INTO v_existing FROM staging.mariadb_price_policy_correction_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN
    IF v_existing->>'correction_run_key' IS DISTINCT FROM p_correction_run_key THEN
      RAISE EXCEPTION 'batch token belongs to another correction run';
    END IF;
    RETURN v_existing;
  END IF;

  CREATE TEMP TABLE three_brand_price_input ON COMMIT DROP AS
  SELECT
    NULLIF(record->>'listing_id', '')::uuid AS listing_id,
    record->>'source_record_id' AS source_record_id,
    record->>'source_hash' AS source_hash,
    record#>>'{candidate,brand}' AS brand,
    record#>>'{candidate,reference}' AS reference,
    upper(NULLIF(btrim(record#>>'{candidate,price,currency_original}'), '')) AS currency,
    NULLIF(record#>>'{candidate,price,amount_original}', '')::numeric AS amount_original,
    NULLIF(record#>>'{candidate,price,amount_usd}', '')::numeric AS amount_usd,
    NULLIF(record#>>'{candidate,price,conversion_rate}', '')::numeric AS conversion_rate,
    NULLIF(record#>>'{candidate,price,conversion_timestamp}', '')::timestamptz AS conversion_timestamp,
    NULLIF(btrim(record#>>'{candidate,price,conversion_source}'), '') AS conversion_source,
    NULLIF(btrim(record#>>'{candidate,price,currency_evidence}'), '') AS currency_evidence
  FROM jsonb_array_elements(p_records) AS record;

  IF EXISTS (
    SELECT 1 FROM three_brand_price_input AS input
    WHERE input.listing_id IS NULL OR COALESCE(input.source_record_id, '') = ''
      OR input.source_hash !~ '^[0-9a-f]{64}$'
      OR input.brand NOT IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
      OR COALESCE(input.reference, '') = '' OR input.amount_original <= 0 OR input.amount_usd <= 0
      OR NOT (input.currency = ANY(v_run.supported_currencies || ARRAY['USDT']))
      OR input.conversion_rate <= 0 OR input.conversion_source IS NULL
      OR (
        input.currency IN ('USD', 'USDT')
        AND (input.conversion_rate IS DISTINCT FROM 1 OR abs(input.amount_usd - input.amount_original) > 0.01
          OR input.conversion_timestamp IS NOT NULL
          OR input.conversion_source NOT IN ('SOURCE_USD_OR_USDT','USD_DEFAULTED_BY_POLICY'))
      )
      OR (
        input.currency NOT IN ('USD', 'USDT')
        AND (input.conversion_timestamp IS DISTINCT FROM (v_run.fx_snapshot->>'observed_at')::timestamptz
          OR input.conversion_source IS DISTINCT FROM v_run.fx_snapshot->>'source'
          OR abs(input.conversion_rate - (v_run.fx_snapshot->'usd_per_unit'->>input.currency)::numeric) > 0.000000000001
          OR abs(input.amount_usd - round(input.amount_original * input.conversion_rate)) > 1.01)
      )
  ) THEN
    RAISE EXCEPTION 'batch contains unsupported or snapshot-unbound price evidence';
  END IF;
  IF (SELECT count(DISTINCT listing_id) FROM three_brand_price_input) <> v_input_rows
    OR (SELECT count(DISTINCT source_record_id) FROM three_brand_price_input) <> v_input_rows THEN
    RAISE EXCEPTION 'batch contains duplicate listing or source lineage';
  END IF;

  SELECT count(*) INTO v_match_rows
  FROM three_brand_price_input AS input
  JOIN staging.listings AS listing
    ON listing.id = input.listing_id
   AND listing.normalization_run_key = v_run.normalization_run_key
   AND listing.source_record_id = input.source_record_id
   AND listing.source_hash = input.source_hash
   AND listing.brand_normalized = input.brand
   AND listing.reference_normalized = input.reference
   AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
  JOIN public.raw_message_versions AS version
    ON version.id = listing.raw_message_version_id
   AND version.source_record_id = listing.source_record_id
   AND version.source_hash = listing.source_hash;
  IF v_match_rows <> v_input_rows THEN
    RAISE EXCEPTION 'exact immutable lineage membership did not reconcile: %/%', v_match_rows, v_input_rows;
  END IF;

  SELECT count(*) INTO v_before_rows FROM staging.listings;
  v_result := jsonb_build_object(
    'correction_run_key', p_correction_run_key,
    'normalization_run_key', v_run.normalization_run_key,
    'input_rows', v_input_rows,
    'corrected_rows', v_match_rows,
    'duplicate_staging_rows_created', 0,
    'fx_contract', v_run.fx_snapshot->>'contract',
    'fx_observed_at', v_run.fx_snapshot->>'observed_at',
    'fx_source', v_run.fx_snapshot->>'source'
  );
  INSERT INTO staging.mariadb_price_policy_correction_batches (
    batch_token, run_key, source_rows, corrected_rows, result
  ) VALUES (p_batch_token, v_run.normalization_run_key, v_input_rows, v_match_rows, v_result);

  INSERT INTO staging.mariadb_price_policy_correction_audit (
    batch_token, listing_id, run_key, source_record_id, previous_price, corrected_price
  )
  SELECT p_batch_token, listing.id, v_run.normalization_run_key, listing.source_record_id,
    jsonb_build_object(
      'price_original', listing.price_original, 'price_usd', listing.price_usd,
      'currency', listing.currency_normalized, 'currency_evidence', listing.currency_evidence,
      'conversion_rate', listing.conversion_rate, 'conversion_timestamp', listing.conversion_timestamp,
      'conversion_source', listing.conversion_source),
    jsonb_build_object(
      'price_original', input.amount_original, 'price_usd', input.amount_usd,
      'currency', input.currency, 'currency_evidence', input.currency_evidence,
      'conversion_rate', input.conversion_rate, 'conversion_timestamp', input.conversion_timestamp,
      'conversion_source', input.conversion_source, 'fx_snapshot_contract', v_run.fx_snapshot->>'contract')
  FROM three_brand_price_input AS input
  JOIN staging.listings AS listing ON listing.id = input.listing_id;

  WITH updated AS (
    UPDATE staging.listings AS listing
    SET price_original = input.amount_original,
        price_normalized = input.amount_original,
        price_usd = input.amount_usd,
        currency_original = input.currency,
        currency_normalized = input.currency,
        currency_evidence = input.currency_evidence,
        conversion_rate = input.conversion_rate,
        conversion_timestamp = input.conversion_timestamp,
        conversion_source = input.conversion_source,
        provenance_metadata = COALESCE(listing.provenance_metadata, '{}'::jsonb) || jsonb_build_object(
          'price_policy_correction_run', p_correction_run_key,
          'price_policy_correction_batch', p_batch_token,
          'fx_snapshot_contract', v_run.fx_snapshot->>'contract',
          'conversion_source', input.conversion_source,
          'conversion_timestamp', input.conversion_timestamp,
          'conversion_rate', input.conversion_rate)
    FROM three_brand_price_input AS input
    WHERE listing.id = input.listing_id
      AND listing.normalization_run_key = v_run.normalization_run_key
      AND listing.source_record_id = input.source_record_id
      AND listing.source_hash = input.source_hash
    RETURNING listing.id
  ) SELECT count(*) INTO v_updated_rows FROM updated;

  SELECT count(*) INTO v_after_rows FROM staging.listings;
  IF v_updated_rows <> v_input_rows OR v_after_rows <> v_before_rows OR v_after_rows <> v_run.initial_staging_rows THEN
    RAISE EXCEPTION 'price correction violated update-only row reconciliation';
  END IF;
  RETURN v_result || jsonb_build_object('staging_rows_before', v_before_rows,
    'staging_rows_after', v_after_rows, 'staging_row_delta', 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_mariadb_three_brand_price_correction(
  p_correction_run_key TEXT,
  p_expected_cursor UUID,
  p_next_cursor UUID,
  p_scanned_rows INTEGER,
  p_corrected_rows INTEGER,
  p_skipped_rows INTEGER,
  p_correction_batch_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run staging.mariadb_three_brand_price_correction_runs%ROWTYPE;
  v_expected_count BIGINT;
  v_expected_last UUID;
  v_more BOOLEAN;
  v_staging_rows BIGINT;
BEGIN
  IF p_scanned_rows NOT BETWEEN 1 AND 500 OR p_corrected_rows < 0 OR p_skipped_rows < 0
    OR p_corrected_rows + p_skipped_rows <> p_scanned_rows THEN RAISE EXCEPTION 'batch accounting is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_three_brand_price_full:' || p_correction_run_key));
  SELECT * INTO v_run FROM staging.mariadb_three_brand_price_correction_runs
  WHERE correction_run_key = p_correction_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'COMPLETE' OR v_run.cursor_listing_id IS DISTINCT FROM p_expected_cursor THEN
    RAISE EXCEPTION 'stale, completed, or missing correction checkpoint';
  END IF;
  SELECT count(*) INTO v_staging_rows FROM staging.listings;
  IF v_staging_rows <> v_run.initial_staging_rows THEN RAISE EXCEPTION 'staging row count changed during correction'; END IF;

  WITH exact_page AS (
    SELECT listing.id
    FROM staging.listings AS listing
    JOIN public.raw_message_versions AS version ON version.id = listing.raw_message_version_id
      AND version.source_record_id = listing.source_record_id AND version.source_hash = listing.source_hash
    WHERE listing.normalization_run_key = v_run.normalization_run_key
      AND listing.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND (v_run.cursor_listing_id IS NULL OR listing.id > v_run.cursor_listing_id)
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (
        COALESCE(listing.price_usd, 0) <= 0
        OR (upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD','USDT')
          AND (COALESCE(listing.conversion_rate, 0) <= 0 OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL))
        OR (p_correction_batch_token IS NOT NULL
          AND listing.provenance_metadata->>'price_policy_correction_batch' = p_correction_batch_token)
      )
    ORDER BY listing.id LIMIT p_scanned_rows
  ) SELECT count(*), (array_agg(id ORDER BY id DESC))[1]
      INTO v_expected_count, v_expected_last FROM exact_page;
  IF v_expected_count <> p_scanned_rows OR v_expected_last IS DISTINCT FROM p_next_cursor THEN
    RAISE EXCEPTION 'cursor page membership does not reconcile';
  END IF;

  IF p_corrected_rows > 0 THEN
    PERFORM 1 FROM staging.mariadb_price_policy_correction_batches
    WHERE batch_token = p_correction_batch_token AND run_key = v_run.normalization_run_key
      AND source_rows = p_corrected_rows AND corrected_rows = p_corrected_rows
      AND result->>'correction_run_key' = p_correction_run_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'correction batch audit does not reconcile'; END IF;
  ELSIF p_correction_batch_token IS NOT NULL THEN
    RAISE EXCEPTION 'zero-correction page must not claim a correction batch';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM staging.listings AS listing
    JOIN public.raw_message_versions AS version ON version.id = listing.raw_message_version_id
      AND version.source_record_id = listing.source_record_id AND version.source_hash = listing.source_hash
    WHERE listing.normalization_run_key = v_run.normalization_run_key AND listing.id > p_next_cursor
      AND listing.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (COALESCE(listing.price_usd, 0) <= 0 OR
        (upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD','USDT')
          AND (COALESCE(listing.conversion_rate, 0) <= 0 OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL)))
  ) INTO v_more;

  UPDATE staging.mariadb_three_brand_price_correction_runs
  SET cursor_listing_id = p_next_cursor,
      scanned_rows = scanned_rows + p_scanned_rows,
      corrected_rows = corrected_rows + p_corrected_rows,
      skipped_rows = skipped_rows + p_skipped_rows,
      batch_sequence = batch_sequence + 1,
      status = CASE WHEN v_more THEN 'RUNNING' ELSE 'COMPLETE' END,
      updated_at = now(), completed_at = CASE WHEN v_more THEN NULL ELSE now() END
  WHERE correction_run_key = p_correction_run_key RETURNING * INTO v_run;
  IF NOT v_more AND v_run.scanned_rows <> v_run.census_rows THEN
    RAISE EXCEPTION 'completed scan does not match fixed initial census';
  END IF;
  RETURN to_jsonb(v_run) || jsonb_build_object('staging_rows_created', 0, 'staging_row_delta', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.start_mariadb_three_brand_price_correction(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qnsa_three_brand_price_correction_page(TEXT,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_mariadb_three_brand_price_policy_batch(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_mariadb_three_brand_price_correction(TEXT,UUID,UUID,INTEGER,INTEGER,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_mariadb_three_brand_price_correction(TEXT,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_mariadb_three_brand_price_policy_batch(TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_mariadb_three_brand_price_correction(TEXT,UUID,UUID,INTEGER,INTEGER,INTEGER,TEXT) TO service_role;

DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.qnsa_three_brand_price_correction_page(TEXT,INTEGER) TO %I', current_user);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    GRANT EXECUTE ON FUNCTION public.qnsa_three_brand_price_correction_page(TEXT,INTEGER) TO supabase_admin;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_mariadb_three_brand_price_policy_batch(TEXT,TEXT,JSONB) IS
  'Snapshot-bound exact-lineage price-only UPDATE for existing Rolex, Patek Philippe, and Audemars Piguet staging rows; immutable raw evidence is read only.';

COMMIT;
