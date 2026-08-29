-- Forward-only transport correction for USD-defaulted and dated FX evidence.
-- The v1 ingestion RPC remains intact for historical auditability. The v2
-- wrapper calls it atomically, then applies only validated price provenance to
-- the rows materialized by that exact batch/run.

BEGIN;

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS conversion_source TEXT;

CREATE TABLE IF NOT EXISTS staging.mariadb_price_policy_correction_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  source_rows INTEGER NOT NULL CHECK (source_rows BETWEEN 1 AND 500),
  corrected_rows INTEGER NOT NULL CHECK (corrected_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.mariadb_price_policy_correction_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_token TEXT NOT NULL REFERENCES staging.mariadb_price_policy_correction_batches(batch_token) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES staging.listings(id) ON DELETE RESTRICT,
  run_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  previous_price JSONB NOT NULL,
  corrected_price JSONB NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_token, listing_id)
);

ALTER TABLE staging.mariadb_price_policy_correction_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.mariadb_price_policy_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.mariadb_price_policy_correction_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON staging.mariadb_price_policy_correction_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.mariadb_price_policy_correction_batches TO service_role;
GRANT ALL ON staging.mariadb_price_policy_correction_audit TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_mariadb_normalization_batch_v2(
  p_run_key TEXT,
  p_raw_import_run_key TEXT,
  p_contract TEXT,
  p_input_fingerprint TEXT,
  p_batch_token TEXT,
  p_expected_input_rows BIGINT,
  p_next_input_rows BIGINT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_result JSONB;
  v_invalid_count BIGINT;
  v_updated_count BIGINT;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'p_records must contain between 1 and 500 records';
  END IF;

  -- Validate every transported conversion before invoking the durable v1
  -- batch. USD/USDT may be explicit or policy-defaulted and always use rate 1.
  -- Every other currency requires a positive rate, timestamp, named source,
  -- and an amount consistent with amount_original * conversion_rate.
  WITH prices AS (
    SELECT
      record->>'materialization' AS materialization,
      upper(NULLIF(btrim(record#>>'{candidate,price,currency_original}'), '')) AS currency,
      NULLIF(record#>>'{candidate,price,amount_original}', '')::numeric AS amount_original,
      NULLIF(record#>>'{candidate,price,amount_usd}', '')::numeric AS amount_usd,
      NULLIF(record#>>'{candidate,price,conversion_rate}', '')::numeric AS conversion_rate,
      NULLIF(record#>>'{candidate,price,conversion_timestamp}', '')::timestamptz AS conversion_timestamp,
      NULLIF(btrim(record#>>'{candidate,price,conversion_source}'), '') AS conversion_source,
      NULLIF(btrim(record#>>'{candidate,price,currency_evidence}'), '') AS currency_evidence
    FROM jsonb_array_elements(p_records) AS record
    WHERE record->>'materialization' = 'SINGLE'
      AND record#>>'{candidate,price,amount_original}' IS NOT NULL
  )
  SELECT count(*) INTO v_invalid_count
  FROM prices
  WHERE amount_original IS NULL OR amount_original <= 0
    OR currency IS NULL
    OR (
      currency IN ('USD', 'USDT')
      AND (
        amount_usd IS NULL OR amount_usd <= 0
        OR conversion_rate IS DISTINCT FROM 1
        OR abs(amount_usd - amount_original) > 0.01
        OR conversion_source IS NULL
        OR (
          currency_evidence = 'usd_defaulted_by_policy'
          AND conversion_source <> 'USD_DEFAULTED_BY_POLICY'
        )
      )
    )
    OR (
      currency NOT IN ('USD', 'USDT')
      AND (
        amount_usd IS NULL OR amount_usd <= 0
        OR conversion_rate IS NULL OR conversion_rate <= 0
        OR conversion_timestamp IS NULL
        OR conversion_source IS NULL
        OR abs(amount_usd - round(amount_original * conversion_rate)) > 1.01
      )
    );
  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'batch contains % invalid or unproven price conversions', v_invalid_count;
  END IF;

  v_result := public.ingest_mariadb_normalization_batch(
    p_run_key,
    p_raw_import_run_key,
    p_contract,
    p_input_fingerprint,
    p_batch_token,
    p_expected_input_rows,
    p_next_input_rows,
    p_records
  );

  WITH transported AS (
    SELECT
      record->>'source_record_id' AS source_record_id,
      upper(NULLIF(btrim(record#>>'{candidate,price,currency_original}'), '')) AS currency,
      NULLIF(record#>>'{candidate,price,amount_usd}', '')::numeric AS amount_usd,
      NULLIF(record#>>'{candidate,price,conversion_rate}', '')::numeric AS conversion_rate,
      NULLIF(record#>>'{candidate,price,conversion_timestamp}', '')::timestamptz AS conversion_timestamp,
      NULLIF(btrim(record#>>'{candidate,price,conversion_source}'), '') AS conversion_source
    FROM jsonb_array_elements(p_records) AS record
    WHERE record->>'materialization' = 'SINGLE'
      AND record#>>'{candidate,price,amount_usd}' IS NOT NULL
  ), updated AS (
    UPDATE staging.listings AS listing
    SET price_usd = transported.amount_usd,
        conversion_rate = transported.conversion_rate,
        conversion_timestamp = CASE
          WHEN transported.currency IN ('USD', 'USDT') THEN NULL
          ELSE transported.conversion_timestamp
        END,
        conversion_source = transported.conversion_source,
        provenance_metadata = COALESCE(listing.provenance_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'conversion_source', transported.conversion_source,
            'conversion_timestamp', transported.conversion_timestamp,
            'conversion_rate', transported.conversion_rate
          )
    FROM transported
    WHERE listing.normalization_run_key = p_run_key
      AND listing.source_record_id = transported.source_record_id
    RETURNING listing.id
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  IF v_updated_count > COALESCE((v_result->>'staged_rows')::bigint, 0)
      + COALESCE((v_result->>'existing_rows')::bigint, 0) THEN
    RAISE EXCEPTION 'FX transport updated more rows than the batch reconciled';
  END IF;

  RETURN v_result || jsonb_build_object('price_provenance_rows', v_updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_mariadb_normalization_batch_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_normalization_batch_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB
) TO service_role;

COMMENT ON FUNCTION public.ingest_mariadb_normalization_batch_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB
) IS 'Atomic v2 staging transport for policy-defaulted USD and dated, source-named FX conversions.';

CREATE OR REPLACE FUNCTION public.apply_mariadb_two_brand_price_policy_batch(
  p_run_key TEXT,
  p_batch_token TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_existing JSONB;
  v_input_rows INTEGER;
  v_match_rows INTEGER;
  v_result JSONB;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' OR p_batch_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'valid run key and batch token are required';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'p_records must contain between 1 and 500 records';
  END IF;
  v_input_rows := jsonb_array_length(p_records);
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_price_policy_correction:' || p_run_key));

  SELECT result INTO v_existing
  FROM staging.mariadb_price_policy_correction_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN RETURN v_existing; END IF;

  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_run_key AND status = 'NORMALIZATION_STAGED' AND error_rows = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'target normalization run is not complete and reconciled'; END IF;

  CREATE TEMP TABLE price_policy_correction_input ON COMMIT DROP AS
  SELECT
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
    SELECT 1 FROM price_policy_correction_input
    WHERE COALESCE(source_record_id, '') = '' OR source_hash !~ '^[0-9a-f]{64}$'
      OR brand NOT IN ('Rolex', 'Patek Philippe')
      OR COALESCE(reference, '') = '' OR amount_original <= 0 OR amount_usd <= 0
      OR currency IS NULL OR conversion_rate <= 0 OR conversion_source IS NULL
      OR (
        currency IN ('USD', 'USDT')
        AND (conversion_rate IS DISTINCT FROM 1 OR abs(amount_usd - amount_original) > 0.01)
      )
      OR (
        currency NOT IN ('USD', 'USDT')
        AND (conversion_timestamp IS NULL OR abs(amount_usd - round(amount_original * conversion_rate)) > 1.01)
      )
  ) THEN
    RAISE EXCEPTION 'price correction contains invalid identity, lineage, or conversion evidence';
  END IF;
  IF (SELECT count(DISTINCT source_record_id) FROM price_policy_correction_input) <> v_input_rows THEN
    RAISE EXCEPTION 'price correction contains duplicate source_record_id values';
  END IF;

  SELECT count(*) INTO v_match_rows
  FROM price_policy_correction_input AS input
  JOIN staging.listings AS listing
    ON listing.normalization_run_key = p_run_key
   AND listing.source_record_id = input.source_record_id
   AND listing.source_hash = input.source_hash
   AND listing.brand_normalized = input.brand
   AND listing.reference_normalized = input.reference
   AND listing.parent_id IS NULL
   AND COALESCE(listing.is_bundle, false) = false;
  IF v_match_rows <> v_input_rows THEN
    RAISE EXCEPTION 'price correction exact-lineage membership did not reconcile: %/%', v_match_rows, v_input_rows;
  END IF;

  -- Reserve the token before writing audit rows so all effects remain atomic.
  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'input_rows', v_input_rows,
    'corrected_rows', v_match_rows,
    'duplicate_staging_rows_created', 0
  );
  INSERT INTO staging.mariadb_price_policy_correction_batches (
    batch_token, run_key, source_rows, corrected_rows, result
  ) VALUES (p_batch_token, p_run_key, v_input_rows, v_match_rows, v_result);

  INSERT INTO staging.mariadb_price_policy_correction_audit (
    batch_token, listing_id, run_key, source_record_id, previous_price, corrected_price
  )
  SELECT
    p_batch_token,
    listing.id,
    p_run_key,
    listing.source_record_id,
    jsonb_build_object(
      'price_original', listing.price_original,
      'price_usd', listing.price_usd,
      'currency', listing.currency_normalized,
      'currency_evidence', listing.currency_evidence,
      'conversion_rate', listing.conversion_rate,
      'conversion_timestamp', listing.conversion_timestamp,
      'conversion_source', listing.conversion_source
    ),
    jsonb_build_object(
      'price_original', input.amount_original,
      'price_usd', input.amount_usd,
      'currency', input.currency,
      'currency_evidence', input.currency_evidence,
      'conversion_rate', input.conversion_rate,
      'conversion_timestamp', input.conversion_timestamp,
      'conversion_source', input.conversion_source
    )
  FROM price_policy_correction_input AS input
  JOIN staging.listings AS listing
    ON listing.normalization_run_key = p_run_key
   AND listing.source_record_id = input.source_record_id;

  UPDATE staging.listings AS listing
  SET price_original = input.amount_original,
      price_normalized = input.amount_original,
      price_usd = input.amount_usd,
      currency_original = input.currency,
      currency_normalized = input.currency,
      currency_evidence = input.currency_evidence,
      conversion_rate = input.conversion_rate,
      conversion_timestamp = CASE WHEN input.currency IN ('USD', 'USDT') THEN NULL ELSE input.conversion_timestamp END,
      conversion_source = input.conversion_source,
      provenance_metadata = COALESCE(listing.provenance_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'price_policy_correction_batch', p_batch_token,
          'conversion_source', input.conversion_source,
          'conversion_timestamp', input.conversion_timestamp,
          'conversion_rate', input.conversion_rate
        )
  FROM price_policy_correction_input AS input
  WHERE listing.normalization_run_key = p_run_key
    AND listing.source_record_id = input.source_record_id
    AND listing.source_hash = input.source_hash;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mariadb_two_brand_price_policy_batch(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mariadb_two_brand_price_policy_batch(TEXT, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.apply_mariadb_two_brand_price_policy_batch(TEXT, TEXT, JSONB) IS
  'Audited exact-lineage Rolex/Patek price-only correction. Creates no duplicate staging listings and changes no identity, seller, media, bundle, or raw evidence.';

COMMIT;
