-- Copy-first historical ingestion for the legacy MariaDB auctions archive.
-- This migration does not normalize listings and does not write watch_records.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.raw_message_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message_id UUID NOT NULL REFERENCES public.raw_messages(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_created_on TEXT,
  source_updated_on TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  raw_message_source TEXT,
  raw_text TEXT,
  raw_payload JSONB NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_message_versions_identity UNIQUE (raw_message_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_message_versions_source_record
  ON public.raw_message_versions (source_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mariadb_raw_import_checkpoints (
  run_key TEXT PRIMARY KEY,
  contract TEXT NOT NULL,
  last_created_on TEXT NOT NULL,
  last_source_id TEXT NOT NULL,
  input_rows BIGINT NOT NULL DEFAULT 0,
  envelope_rows_inserted BIGINT NOT NULL DEFAULT 0,
  version_rows_inserted BIGINT NOT NULL DEFAULT 0,
  version_rows_existing BIGINT NOT NULL DEFAULT 0,
  error_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COPYING_RAW',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mariadb_raw_import_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES public.mariadb_raw_import_checkpoints(run_key) ON DELETE RESTRICT,
  first_source_id TEXT,
  last_source_id TEXT,
  source_rows INTEGER NOT NULL CHECK (source_rows >= 0),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.raw_message_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mariadb_raw_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mariadb_raw_import_batches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_message_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mariadb_raw_import_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mariadb_raw_import_batches FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.raw_message_versions TO service_role;
GRANT ALL ON public.mariadb_raw_import_checkpoints TO service_role;
GRANT ALL ON public.mariadb_raw_import_batches TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_mariadb_raw_batch(
  p_run_key TEXT,
  p_batch_token TEXT,
  p_contract TEXT,
  p_expected_last_created_on TEXT,
  p_expected_last_source_id TEXT,
  p_next_last_created_on TEXT,
  p_next_last_source_id TEXT,
  p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_record JSONB;
  v_raw_data JSONB;
  v_raw_message_id UUID;
  v_inserted_id UUID;
  v_existing_result JSONB;
  v_input_rows INTEGER := 0;
  v_envelopes_inserted INTEGER := 0;
  v_versions_inserted INTEGER := 0;
  v_versions_existing INTEGER := 0;
  v_result JSONB;
BEGIN
  IF p_run_key IS NULL OR btrim(p_run_key) = '' THEN
    RAISE EXCEPTION 'run_key is required';
  END IF;
  IF p_batch_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'batch_token must be a lowercase SHA-256 digest';
  END IF;
  IF p_contract <> 'wf-mariadb-auctions-raw-v1' THEN
    RAISE EXCEPTION 'unsupported raw import contract: %', p_contract;
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RAISE EXCEPTION 'records must be a JSON array';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mariadb_raw_import:' || p_run_key));

  SELECT result INTO v_existing_result
  FROM public.mariadb_raw_import_batches
  WHERE batch_token = p_batch_token;
  IF FOUND THEN
    RETURN v_existing_result || jsonb_build_object('idempotent_replay', true);
  END IF;

  INSERT INTO public.mariadb_raw_import_checkpoints (
    run_key, contract, last_created_on, last_source_id
  ) VALUES (
    p_run_key, p_contract, p_expected_last_created_on, p_expected_last_source_id
  )
  ON CONFLICT (run_key) DO NOTHING;

  PERFORM 1
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
    AND contract = p_contract
    AND last_created_on = p_expected_last_created_on
    AND last_source_id = p_expected_last_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or incompatible raw-import checkpoint for run %', p_run_key;
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_input_rows := v_input_rows + 1;
    IF v_record->>'contract' <> p_contract THEN
      RAISE EXCEPTION 'record % has an incompatible contract', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'source_record_id', '') = '' THEN
      RAISE EXCEPTION 'record % is missing source_record_id', v_input_rows;
    END IF;
    IF COALESCE(v_record->>'raw_sha256', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'record % has an invalid raw_sha256', v_input_rows;
    END IF;

    v_raw_data := COALESCE(v_record->'raw_data', '{}'::jsonb);
    v_inserted_id := NULL;

    INSERT INTO public.raw_messages (
      external_message_id,
      sender_phone,
      group_id,
      source_platform,
      received_at,
      raw_text,
      raw_payload,
      media_count,
      processing_status,
      parser_version
    ) VALUES (
      v_record->>'source_record_id',
      v_raw_data->>'from_number',
      v_raw_data->>'region',
      'mariadb',
      COALESCE((v_record->>'observed_at')::timestamptz, now()),
      COALESCE(v_record->>'raw_message', ''),
      v_record,
      CASE WHEN NULLIF(v_raw_data->>'front_image', '') IS NULL THEN 0 ELSE 1 END,
      'COPIED_RAW',
      NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NOT NULL THEN
      v_envelopes_inserted := v_envelopes_inserted + 1;
      v_raw_message_id := v_inserted_id;
    ELSE
      SELECT id INTO v_raw_message_id
      FROM public.raw_messages
      WHERE source_platform = 'mariadb'
        AND external_message_id = v_record->>'source_record_id';
    END IF;

    IF v_raw_message_id IS NULL THEN
      RAISE EXCEPTION 'record % could not resolve its immutable raw envelope', v_input_rows;
    END IF;

    v_inserted_id := NULL;
    INSERT INTO public.raw_message_versions (
      raw_message_id,
      source_record_id,
      source_hash,
      source_created_on,
      source_updated_on,
      observed_at,
      raw_message_source,
      raw_text,
      raw_payload,
      media
    ) VALUES (
      v_raw_message_id,
      v_record->>'source_record_id',
      v_record->>'raw_sha256',
      v_record->>'source_created_on',
      v_raw_data->>'updated_on',
      (v_record->>'observed_at')::timestamptz,
      v_record->>'raw_message_source',
      v_record->>'raw_message',
      v_record,
      CASE
        WHEN NULLIF(v_raw_data->>'front_image', '') IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'source_key', v_raw_data->>'front_image',
          'relationship', 'source_record_media',
          'verified_for_child_listing', false
        ))
      END
    )
    ON CONFLICT (raw_message_id, source_hash) DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      v_versions_existing := v_versions_existing + 1;
    ELSE
      v_versions_inserted := v_versions_inserted + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'run_key', p_run_key,
    'batch_token', p_batch_token,
    'input_rows', v_input_rows,
    'envelope_rows_inserted', v_envelopes_inserted,
    'version_rows_inserted', v_versions_inserted,
    'version_rows_existing', v_versions_existing,
    'error_rows', 0,
    'last_created_on', p_next_last_created_on,
    'last_source_id', p_next_last_source_id,
    'watch_records_writes', 0,
    'normalization_writes', 0,
    'idempotent_replay', false
  );

  INSERT INTO public.mariadb_raw_import_batches (
    batch_token, run_key, first_source_id, last_source_id, source_rows, result
  ) VALUES (
    p_batch_token,
    p_run_key,
    p_records->0->>'source_record_id',
    p_next_last_source_id,
    v_input_rows,
    v_result
  );

  UPDATE public.mariadb_raw_import_checkpoints
  SET last_created_on = p_next_last_created_on,
      last_source_id = p_next_last_source_id,
      input_rows = input_rows + v_input_rows,
      envelope_rows_inserted = envelope_rows_inserted + v_envelopes_inserted,
      version_rows_inserted = version_rows_inserted + v_versions_inserted,
      version_rows_existing = version_rows_existing + v_versions_existing,
      updated_at = now()
  WHERE run_key = p_run_key;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_mariadb_raw_batch(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_raw_batch(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

COMMENT ON TABLE public.raw_message_versions IS
  'Immutable MariaDB source snapshots. Each changed source row creates a new version; no normalized claim is stored here.';
COMMENT ON FUNCTION public.ingest_mariadb_raw_batch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Atomically copies one reconciled MariaDB raw batch and advances its checkpoint. Does not normalize or publish listings.';

CREATE OR REPLACE FUNCTION public.complete_mariadb_raw_import(
  p_run_key TEXT,
  p_expected_rows BIGINT,
  p_expected_last_created_on TEXT,
  p_expected_last_source_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_checkpoint public.mariadb_raw_import_checkpoints%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_raw_import:' || p_run_key));
  SELECT * INTO v_checkpoint
  FROM public.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'raw-import checkpoint does not exist for run %', p_run_key;
  END IF;
  IF v_checkpoint.input_rows <> p_expected_rows
    OR v_checkpoint.last_created_on <> p_expected_last_created_on
    OR v_checkpoint.last_source_id <> p_expected_last_source_id THEN
    RAISE EXCEPTION 'raw-import completion does not reconcile for run %', p_run_key;
  END IF;
  IF v_checkpoint.input_rows <> v_checkpoint.version_rows_inserted + v_checkpoint.version_rows_existing
    OR v_checkpoint.error_rows <> 0 THEN
    RAISE EXCEPTION 'raw-import version counts do not reconcile for run %', p_run_key;
  END IF;

  UPDATE public.mariadb_raw_import_checkpoints
  SET status = 'RAW_COPY_COMPLETE', completed_at = now(), updated_at = now()
  WHERE run_key = p_run_key
  RETURNING * INTO v_checkpoint;

  RETURN jsonb_build_object(
    'run_key', v_checkpoint.run_key,
    'status', v_checkpoint.status,
    'input_rows', v_checkpoint.input_rows,
    'envelope_rows_inserted', v_checkpoint.envelope_rows_inserted,
    'version_rows_inserted', v_checkpoint.version_rows_inserted,
    'version_rows_existing', v_checkpoint.version_rows_existing,
    'error_rows', v_checkpoint.error_rows,
    'last_created_on', v_checkpoint.last_created_on,
    'last_source_id', v_checkpoint.last_source_id,
    'watch_records_writes', 0,
    'normalization_writes', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_mariadb_raw_import(TEXT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mariadb_raw_import(TEXT, BIGINT, TEXT, TEXT)
  TO service_role;
