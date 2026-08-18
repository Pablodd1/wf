-- Forward-only, private import lane for locally reconciled MariaDB normalization.
--
-- This migration does not publish listings. It requires exact immutable raw
-- version lineage, stages only single-item candidates, and defers every bundle.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS staging;

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS normalization_run_key TEXT,
  ADD COLUMN IF NOT EXISTS source_record_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_message_version_id UUID REFERENCES public.raw_message_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_candidate_hash TEXT,
  ADD COLUMN IF NOT EXISTS currency_evidence TEXT,
  ADD COLUMN IF NOT EXISTS source_posted_at_text TEXT,
  ADD COLUMN IF NOT EXISTS source_media_key TEXT,
  ADD COLUMN IF NOT EXISTS source_media_url_candidate TEXT,
  ADD COLUMN IF NOT EXISTS public_image_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW';

CREATE UNIQUE INDEX IF NOT EXISTS idx_staging_mariadb_run_source
  ON staging.listings (normalization_run_key, source_record_id)
  WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staging_mariadb_raw_version
  ON staging.listings (raw_message_version_id)
  WHERE raw_message_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staging.mariadb_normalization_import_checkpoints (
  run_key TEXT PRIMARY KEY,
  normalization_contract TEXT NOT NULL,
  raw_import_run_key TEXT NOT NULL REFERENCES public.mariadb_raw_import_checkpoints(run_key) ON DELETE RESTRICT,
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input_rows BIGINT NOT NULL DEFAULT 0,
  staged_rows BIGINT NOT NULL DEFAULT 0,
  existing_rows BIGINT NOT NULL DEFAULT 0,
  deferred_rows BIGINT NOT NULL DEFAULT 0,
  error_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'STAGING_NORMALIZATION',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('STAGING_NORMALIZATION', 'NORMALIZATION_STAGED'))
);

CREATE TABLE IF NOT EXISTS staging.mariadb_normalization_import_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  first_source_record_id TEXT,
  last_source_record_id TEXT,
  source_rows INTEGER NOT NULL CHECK (source_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staging.mariadb_normalization_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.mariadb_normalization_import_batches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON staging.mariadb_normalization_import_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON staging.mariadb_normalization_import_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.mariadb_normalization_import_checkpoints TO service_role;
GRANT ALL ON staging.mariadb_normalization_import_batches TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_mariadb_normalization_batch(
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
  v_record JSONB;
  v_candidate JSONB;
  v_version public.raw_message_versions%ROWTYPE;
  v_existing_result JSONB;
  v_listing_id UUID;
  v_price_original NUMERIC;
  v_price_usd NUMERIC;
  v_currency TEXT;
  v_input_rows INTEGER := 0;
  v_staged_rows INTEGER := 0;
  v_existing_rows INTEGER := 0;
  v_deferred_rows INTEGER := 0;
  v_result JSONB;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' OR COALESCE(btrim(p_raw_import_run_key), '') = '' THEN
    RAISE EXCEPTION 'run_key and raw_import_run_key are required';
  END IF;
  IF p_contract <> 'wf-mariadb-normalized-staging-v1' THEN
    RAISE EXCEPTION 'unsupported normalization staging contract';
  END IF;
  IF p_input_fingerprint !~ '^[0-9a-f]{64}$' OR p_batch_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input fingerprint or batch token';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'p_records must contain between 1 and 500 records';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mariadb_normalization_import:' || p_run_key));

  SELECT result INTO v_existing_result
  FROM staging.mariadb_normalization_import_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN
    IF v_existing_result->>'run_key' IS DISTINCT FROM p_run_key THEN
      RAISE EXCEPTION 'batch token belongs to another normalization run';
    END IF;
    RETURN v_existing_result;
  END IF;

  PERFORM 1
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_raw_import_run_key
    AND status = 'RAW_COPY_COMPLETE'
    AND error_rows = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'immutable raw import is not complete and reconciled';
  END IF;

  INSERT INTO staging.mariadb_normalization_import_checkpoints (
    run_key, normalization_contract, raw_import_run_key, input_fingerprint
  ) VALUES (
    p_run_key, p_contract, p_raw_import_run_key, p_input_fingerprint
  )
  ON CONFLICT (run_key) DO NOTHING;

  PERFORM 1
  FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_run_key
    AND normalization_contract = p_contract
    AND raw_import_run_key = p_raw_import_run_key
    AND input_fingerprint = p_input_fingerprint
    AND input_rows = p_expected_input_rows
    AND status = 'STAGING_NORMALIZATION'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or incompatible normalization staging checkpoint';
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_input_rows := v_input_rows + 1;
    IF v_record ?| ARRAY['raw_message', 'raw_payload', 'seller_phone', 'phone', 'contact_number'] THEN
      RAISE EXCEPTION 'record % contains prohibited duplicated raw or private contact data', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'source_record_id', '') = ''
      OR COALESCE(v_record->>'source_hash', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(v_record->>'source_candidate_hash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'record % has invalid source lineage', v_input_rows;
    END IF;
    IF v_record->>'materialization' NOT IN ('SINGLE', 'DEFERRED') THEN
      RAISE EXCEPTION 'record % has invalid materialization', v_input_rows;
    END IF;

    SELECT version.* INTO v_version
    FROM public.raw_message_versions AS version
    WHERE version.source_record_id = v_record->>'source_record_id'
      AND version.source_hash = v_record->>'source_hash'
    ORDER BY version.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record % cannot resolve exact immutable raw-version lineage', v_input_rows;
    END IF;

    IF v_record->>'materialization' = 'DEFERRED' THEN
      v_deferred_rows := v_deferred_rows + 1;
      CONTINUE;
    END IF;

    v_candidate := COALESCE(v_record->'candidate', '{}'::jsonb);
    IF COALESCE(v_candidate->>'listing_type', '') NOT IN ('WTS', 'WTB')
      OR COALESCE(v_record->>'category', '') NOT IN ('WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY') THEN
      RAISE EXCEPTION 'record % is not an eligible single public-category candidate', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'bundle_status', '') <> 'SINGLE_CANDIDATE' THEN
      RAISE EXCEPTION 'record % attempts to materialize a bundle', v_input_rows;
    END IF;
    IF COALESCE((v_record->>'public_image_eligible')::boolean, false) THEN
      RAISE EXCEPTION 'record % attempts to auto-publish an unreviewed image', v_input_rows;
    END IF;

    v_price_original := CASE
      WHEN COALESCE(v_candidate#>>'{price,amount_original}', '') ~ '^\d+(\.\d+)?$'
      THEN (v_candidate#>>'{price,amount_original}')::numeric
      ELSE NULL
    END;
    v_currency := NULLIF(upper(btrim(v_candidate#>>'{price,currency_original}')), '');
    v_price_usd := CASE
      WHEN v_currency IN ('USD', 'USDT')
        AND COALESCE(v_candidate#>>'{price,amount_usd}', '') ~ '^\d+(\.\d+)?$'
      THEN (v_candidate#>>'{price,amount_usd}')::numeric
      ELSE NULL
    END;

    v_listing_id := NULL;
    INSERT INTO staging.listings (
      id, normalization_run_key, source_record_id, raw_message_version_id, source_hash,
      source_candidate_hash, raw_message_text, category, intent, listing_type, is_bundle,
      brand_original, brand_normalized, model_original, model_normalized,
      reference_original, reference_normalized, dial_color_original, dial_color_normalized,
      price_original, price_normalized, price_usd, currency_original, currency_normalized,
      currency_evidence, condition_original, condition_normalized, image_url,
      source_media_key, source_media_url_candidate, public_image_eligible,
      user_name, from_name, location, rating, dealer_rating, contact_consent,
      catalog_confirmed, catalog_canonical_confirmed, are_attributes_extracted,
      identification_status, verdict, normalization_status, trading_floor_status,
      price_research_status, overall_confidence, publication_review_status,
      source_posted_at_text, provenance_metadata
    ) VALUES (
      gen_random_uuid(), p_run_key, v_record->>'source_record_id', v_version.id,
      v_record->>'source_hash', v_record->>'source_candidate_hash', COALESCE(v_version.raw_text, ''),
      v_record->>'category', v_candidate->>'listing_type', v_candidate->>'listing_type', false,
      left(v_candidate->>'brand', 100), left(v_candidate->>'brand', 100),
      left(v_candidate->>'model', 100), left(v_candidate->>'model', 100),
      left(v_candidate->>'reference', 100), left(v_candidate->>'reference', 100),
      left(v_candidate->>'dial_color', 50), left(v_candidate->>'dial_color', 50),
      v_price_original, v_price_original, v_price_usd, v_currency, v_currency,
      v_candidate#>>'{price,currency_evidence}',
      left(v_candidate->>'condition', 50), left(v_candidate->>'condition', 50), NULL,
      v_record#>>'{media,source_media_key}', v_record#>>'{media,source_media_url_candidate}', false,
      left(v_record#>>'{seller_public,name}', 150), left(v_record#>>'{seller_public,name}', 150),
      left(v_record#>>'{seller_public,location}', 100), NULL, NULL, false,
      COALESCE((v_record->>'catalog_confirmed')::boolean, false),
      COALESCE((v_record->>'catalog_confirmed')::boolean, false), true,
      CASE WHEN v_record->>'category' = 'WATCH' THEN 'pending_verification' ELSE 'classified_non_watch' END,
      'pending',
      CASE WHEN v_record->>'review_disposition' = 'READY_FOR_HUMAN_APPROVAL' THEN 'normalized' ELSE 'needs_review' END,
      'published_pending_verification',
      CASE
        WHEN v_candidate->>'listing_type' = 'WTB' THEN 'demand_pending_human_approval'
        WHEN v_record->>'price_research_status' = 'SALE_PENDING_HUMAN_APPROVAL' THEN 'provisional_needs_review'
        ELSE lower(v_record->>'price_research_status')
      END,
      NULL, 'PENDING_REVIEW', v_record->>'source_created_on',
      jsonb_build_object(
        'contract', p_contract,
        'normalization_version', v_record->>'normalization_version',
        'review_disposition', v_record->>'review_disposition',
        'review_reasons', COALESCE(v_record->'review_reasons', '[]'::jsonb),
        'bundle_status', v_record->>'bundle_status',
        'exact_raw_version_lineage', true,
        'contact_publication_approved', false,
        'rating_publication_status', 'UNVERIFIED_SOURCE_FIELD',
        'source_field_overflow', jsonb_strip_nulls(jsonb_build_object(
          'brand', CASE WHEN length(v_candidate->>'brand') > 100 THEN v_candidate->>'brand' END,
          'model', CASE WHEN length(v_candidate->>'model') > 100 THEN v_candidate->>'model' END,
          'reference', CASE WHEN length(v_candidate->>'reference') > 100 THEN v_candidate->>'reference' END,
          'dial_color', CASE WHEN length(v_candidate->>'dial_color') > 50 THEN v_candidate->>'dial_color' END,
          'condition', CASE WHEN length(v_candidate->>'condition') > 50 THEN v_candidate->>'condition' END,
          'seller_name', CASE WHEN length(v_record#>>'{seller_public,name}') > 150 THEN v_record#>>'{seller_public,name}' END,
          'seller_location', CASE WHEN length(v_record#>>'{seller_public,location}') > 100 THEN v_record#>>'{seller_public,location}' END
        ))
      )
    )
    ON CONFLICT (normalization_run_key, source_record_id)
      WHERE normalization_run_key IS NOT NULL AND source_record_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_listing_id;

    IF v_listing_id IS NULL THEN
      PERFORM 1 FROM staging.listings
      WHERE normalization_run_key = p_run_key
        AND source_record_id = v_record->>'source_record_id'
        AND source_hash = v_record->>'source_hash'
        AND source_candidate_hash = v_record->>'source_candidate_hash'
        AND raw_message_version_id = v_version.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'record % conflicts with previously staged lineage', v_input_rows;
      END IF;
      v_existing_rows := v_existing_rows + 1;
    ELSE
      v_staged_rows := v_staged_rows + 1;
    END IF;
  END LOOP;

  IF p_next_input_rows <> p_expected_input_rows + v_input_rows THEN
    RAISE EXCEPTION 'next input row count does not reconcile';
  END IF;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'input_rows', v_input_rows,
    'staged_rows', v_staged_rows,
    'existing_rows', v_existing_rows,
    'deferred_rows', v_deferred_rows,
    'error_rows', 0,
    'next_input_rows', p_next_input_rows,
    'first_source_record_id', p_records->0->>'source_record_id',
    'last_source_record_id', p_records->(jsonb_array_length(p_records) - 1)->>'source_record_id',
    'publication_writes', 0
  );

  INSERT INTO staging.mariadb_normalization_import_batches (
    batch_token, run_key, first_source_record_id, last_source_record_id, source_rows, result
  ) VALUES (
    p_batch_token, p_run_key, v_result->>'first_source_record_id',
    v_result->>'last_source_record_id', v_input_rows, v_result
  );

  UPDATE staging.mariadb_normalization_import_checkpoints
  SET input_rows = p_next_input_rows,
      staged_rows = staged_rows + v_staged_rows,
      existing_rows = existing_rows + v_existing_rows,
      deferred_rows = deferred_rows + v_deferred_rows,
      updated_at = now()
  WHERE run_key = p_run_key;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_mariadb_normalization_import(
  p_run_key TEXT,
  p_expected_rows BIGINT,
  p_expected_staged_or_existing BIGINT,
  p_expected_deferred BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_checkpoint staging.mariadb_normalization_import_checkpoints%ROWTYPE;
  v_materialized BIGINT;
  v_result JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_normalization_import:' || p_run_key));
  SELECT * INTO v_checkpoint
  FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization staging checkpoint does not exist'; END IF;

  SELECT count(*) INTO v_materialized
  FROM staging.listings
  WHERE normalization_run_key = p_run_key;

  IF v_checkpoint.input_rows <> p_expected_rows
    OR v_checkpoint.error_rows <> 0
    OR v_checkpoint.staged_rows + v_checkpoint.existing_rows <> p_expected_staged_or_existing
    OR v_checkpoint.deferred_rows <> p_expected_deferred
    OR p_expected_staged_or_existing + p_expected_deferred <> p_expected_rows
    OR v_materialized <> p_expected_staged_or_existing THEN
    RAISE EXCEPTION 'normalization staging completion did not reconcile';
  END IF;

  UPDATE staging.mariadb_normalization_import_checkpoints
  SET status = 'NORMALIZATION_STAGED', completed_at = now(), updated_at = now()
  WHERE run_key = p_run_key;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'status', 'NORMALIZATION_STAGED',
    'input_rows', p_expected_rows,
    'materialized_rows', v_materialized,
    'deferred_rows', p_expected_deferred,
    'error_rows', 0,
    'publication_writes', 0
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_mariadb_normalization_batch(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_mariadb_normalization_import(TEXT, BIGINT, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_normalization_batch(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_mariadb_normalization_import(TEXT, BIGINT, BIGINT, BIGINT)
  TO service_role;

COMMENT ON FUNCTION public.ingest_mariadb_normalization_batch(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, JSONB) IS
  'Stages reconciled single-item normalization candidates with exact immutable raw-version lineage; bundles are deferred and nothing is published.';

COMMIT;
