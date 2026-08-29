-- Forward-only, private staging lane for immutable MariaDB raw source rows.
--
-- This migration DOES NOT write to public.raw_messages, public.raw_message_versions,
-- or public.watch_records. It targets strictly wf_canonical_staging.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS wf_canonical_staging;

-- 1. Private Raw Source Staging Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_raw_source_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'OceanDigital MariaDB',
  source_database TEXT NOT NULL DEFAULT 'thecollective_inventory',
  source_table TEXT NOT NULL DEFAULT 'auctions',
  source_id TEXT NOT NULL,
  source_unique_key TEXT,
  source_record_id TEXT NOT NULL,
  source_created_on TEXT,
  source_updated_on TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_message TEXT,
  raw_message_source TEXT,
  raw_sha256 TEXT,
  raw_payload_text TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  hash_algorithm TEXT NOT NULL DEFAULT 'sha256',
  canonicalization_version TEXT NOT NULL DEFAULT 'v1-json-keys-sorted-compact',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_mariadb_raw_staging_provenance_hash 
    UNIQUE (source_system, source_database, source_table, source_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_mariadb_raw_staging_cursor
  ON wf_canonical_staging.mariadb_raw_source_rows (source_created_on, source_id);

CREATE INDEX IF NOT EXISTS idx_mariadb_raw_staging_source_id
  ON wf_canonical_staging.mariadb_raw_source_rows (source_id);

CREATE INDEX IF NOT EXISTS idx_mariadb_raw_staging_source_record_id
  ON wf_canonical_staging.mariadb_raw_source_rows (source_record_id);

-- 2. Checkpoint Ledger
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_raw_import_checkpoints (
  run_key TEXT PRIMARY KEY,
  contract TEXT NOT NULL DEFAULT 'wf-mariadb-private-raw-staging-v1',
  last_created_on TEXT NOT NULL,
  last_source_id TEXT NOT NULL,
  input_rows BIGINT NOT NULL DEFAULT 0,
  newly_staged_rows BIGINT NOT NULL DEFAULT 0,
  already_staged_identical_rows BIGINT NOT NULL DEFAULT 0,
  capture_error_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COPYING_RAW',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('COPYING_RAW', 'RAW_STAGED', 'FAILED', 'VERIFICATION_COMPLETE'))
);

-- 3. Batch Audit Ledger
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_raw_import_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  run_key TEXT NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_import_checkpoints(run_key) ON DELETE RESTRICT,
  first_source_id TEXT,
  last_source_id TEXT,
  source_rows INTEGER NOT NULL CHECK (source_rows >= 0),
  newly_staged_rows INTEGER NOT NULL DEFAULT 0,
  already_staged_identical_rows INTEGER NOT NULL DEFAULT 0,
  capture_error_rows INTEGER NOT NULL DEFAULT 0,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Row-Level Capture Error Ledger
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_raw_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL,
  batch_token TEXT,
  source_id TEXT,
  source_created_on TEXT,
  source_hash TEXT,
  raw_payload_text TEXT NOT NULL,
  raw_payload JSONB,
  error_reason TEXT NOT NULL,
  error_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Object-Specific Privilege Hardening (Immutable Evidence is never updateable)
REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;

REVOKE ALL ON TABLE wf_canonical_staging.mariadb_raw_source_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE wf_canonical_staging.mariadb_raw_source_rows TO service_role;

REVOKE ALL ON TABLE wf_canonical_staging.mariadb_raw_import_checkpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE wf_canonical_staging.mariadb_raw_import_checkpoints TO service_role;

REVOKE ALL ON TABLE wf_canonical_staging.mariadb_raw_import_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE wf_canonical_staging.mariadb_raw_import_batches TO service_role;

REVOKE ALL ON TABLE wf_canonical_staging.mariadb_raw_import_errors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE wf_canonical_staging.mariadb_raw_import_errors TO service_role;

-- 6. Ingestion Stored Procedure with Database-Side Hash Verification
CREATE OR REPLACE FUNCTION public.ingest_mariadb_private_raw_batch(
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
SET search_path = wf_canonical_staging, public, pg_catalog
AS 
DECLARE
  v_checkpoint wf_canonical_staging.mariadb_raw_import_checkpoints%ROWTYPE;
  v_batch wf_canonical_staging.mariadb_raw_import_batches%ROWTYPE;
  v_record JSONB;
  v_source_system TEXT;
  v_source_database TEXT;
  v_source_table TEXT;
  v_source_id TEXT;
  v_source_unique_key TEXT;
  v_source_record_id TEXT;
  v_source_created_on TEXT;
  v_source_updated_on TEXT;
  v_captured_at TIMESTAMPTZ;
  v_raw_message TEXT;
  v_raw_message_source TEXT;
  v_raw_sha256 TEXT;
  v_raw_payload_text TEXT;
  v_raw_payload JSONB;
  v_source_hash TEXT;
  v_computed_hash TEXT;
  v_hash_algo TEXT;
  v_canon_version TEXT;
  v_input_rows INTEGER := 0;
  v_newly_staged INTEGER := 0;
  v_already_staged INTEGER := 0;
  v_capture_errors INTEGER := 0;
  v_existing_id UUID;
  v_first_source_id TEXT := NULL;
  v_last_source_id TEXT := NULL;
  v_result JSONB;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' OR COALESCE(btrim(p_batch_token), '') = '' THEN
    RAISE EXCEPTION 'run_key and batch_token are required';
  END IF;

  IF p_contract <> 'wf-mariadb-private-raw-staging-v1' THEN
    RAISE EXCEPTION 'Unsupported contract: %', p_contract;
  END IF;

  -- Check if batch was already applied
  SELECT * INTO v_batch
  FROM wf_canonical_staging.mariadb_raw_import_batches
  WHERE batch_token = p_batch_token;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_APPLIED',
      'batch_token', p_batch_token,
      'run_key', p_run_key,
      'source_rows', v_batch.source_rows,
      'newly_staged_rows', v_batch.newly_staged_rows,
      'already_staged_identical_rows', v_batch.already_staged_identical_rows,
      'capture_error_rows', v_batch.capture_error_rows
    );
  END IF;

  -- Lock checkpoint
  SELECT * INTO v_checkpoint
  FROM wf_canonical_staging.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints (
      run_key, contract, last_created_on, last_source_id, input_rows,
      newly_staged_rows, already_staged_identical_rows, capture_error_rows, status
    ) VALUES (
      p_run_key, p_contract, COALESCE(p_expected_last_created_on, ''), COALESCE(p_expected_last_source_id, ''), 0,
      0, 0, 0, 'COPYING_RAW'
    ) RETURNING * INTO v_checkpoint;
  END IF;

  -- Verify cursor continuity
  IF v_checkpoint.input_rows > 0 THEN
    IF COALESCE(v_checkpoint.last_created_on, '') <> COALESCE(p_expected_last_created_on, '') OR
       COALESCE(v_checkpoint.last_source_id, '') <> COALESCE(p_expected_last_source_id, '') THEN
      RAISE EXCEPTION 'Checkpoint cursor mismatch: expected (%, %), found (%, %)',
        v_checkpoint.last_created_on, v_checkpoint.last_source_id,
        p_expected_last_created_on, p_expected_last_source_id;
    END IF;
  END IF;

  -- Process records
  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_input_rows := v_input_rows + 1;

    BEGIN
      v_source_system := COALESCE(v_record->>'source_system', 'OceanDigital MariaDB');
      v_source_database := COALESCE(v_record->>'source_database', 'thecollective_inventory');
      v_source_table := COALESCE(v_record->>'source_table', 'auctions');
      v_source_id := v_record->>'source_id';
      v_source_unique_key := v_record->>'source_unique_key';
      v_source_record_id := COALESCE(v_record->>'source_record_id', 'mysql_auctions_' || v_source_id);
      v_source_created_on := v_record->>'source_created_on';
      v_source_updated_on := v_record->>'source_updated_on';
      v_captured_at := COALESCE((v_record->>'captured_at')::timestamptz, now());
      v_raw_message := v_record->>'raw_message';
      v_raw_message_source := v_record->>'raw_message_source';
      v_raw_sha256 := v_record->>'raw_sha256';
      v_raw_payload_text := v_record->>'raw_payload_text';
      v_raw_payload := v_record->'raw_payload';
      v_source_hash := v_record->>'source_hash';
      v_hash_algo := COALESCE(v_record->>'hash_algorithm', 'sha256');
      v_canon_version := COALESCE(v_record->>'canonicalization_version', 'v1-json-keys-sorted-compact');

      IF v_first_source_id IS NULL THEN
        v_first_source_id := v_source_id;
      END IF;
      v_last_source_id := v_source_id;

      IF v_source_id IS NULL OR v_source_hash IS NULL OR v_raw_payload_text IS NULL THEN
        RAISE EXCEPTION 'Missing mandatory identity fields: source_id, source_hash, or raw_payload_text';
      END IF;

      -- Database-Side SHA-256 Verification
      v_computed_hash := encode(digest(v_raw_payload_text, 'sha256'), 'hex');
      IF v_computed_hash <> v_source_hash THEN
        RAISE EXCEPTION 'Database-side hash verification failed: computed %, expected %', v_computed_hash, v_source_hash;
      END IF;

      -- Check for existing identical staged row
      SELECT id INTO v_existing_id
      FROM wf_canonical_staging.mariadb_raw_source_rows
      WHERE source_system = v_source_system
        AND source_database = v_source_database
        AND source_table = v_source_table
        AND source_id = v_source_id
        AND source_hash = v_source_hash;

      IF FOUND THEN
        v_already_staged := v_already_staged + 1;
      ELSE
        INSERT INTO wf_canonical_staging.mariadb_raw_source_rows (
          source_system, source_database, source_table, source_id, source_unique_key,
          source_record_id, source_created_on, source_updated_on, captured_at,
          raw_message, raw_message_source, raw_sha256, raw_payload_text, raw_payload,
          source_hash, hash_algorithm, canonicalization_version
        ) VALUES (
          v_source_system, v_source_database, v_source_table, v_source_id, v_source_unique_key,
          v_source_record_id, v_source_created_on, v_source_updated_on, v_captured_at,
          v_raw_message, v_raw_message_source, v_raw_sha256, v_raw_payload_text, COALESCE(v_raw_payload, '{}'::jsonb),
          v_source_hash, v_hash_algo, v_canon_version
        );
        v_newly_staged := v_newly_staged + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_capture_errors := v_capture_errors + 1;
      INSERT INTO wf_canonical_staging.mariadb_raw_import_errors (
        run_key, batch_token, source_id, source_created_on, source_hash,
        raw_payload_text, raw_payload, error_reason, error_detail
      ) VALUES (
        p_run_key, p_batch_token, v_source_id, v_source_created_on, v_source_hash,
        COALESCE(v_raw_payload_text, v_record::text), v_raw_payload, SQLERRM,
        jsonb_build_object('sqlstate', SQLSTATE, 'record_sample', v_record)
      );
    END;
  END LOOP;

  -- Update Checkpoint
  UPDATE wf_canonical_staging.mariadb_raw_import_checkpoints
  SET last_created_on = p_next_last_created_on,
      last_source_id = p_next_last_source_id,
      input_rows = input_rows + v_input_rows,
      newly_staged_rows = newly_staged_rows + v_newly_staged,
      already_staged_identical_rows = already_staged_identical_rows + v_already_staged,
      capture_error_rows = capture_error_rows + v_capture_errors,
      updated_at = now()
  WHERE run_key = p_run_key;

  -- Record Batch Execution
  v_result := jsonb_build_object(
    'status', 'APPLIED',
    'batch_token', p_batch_token,
    'run_key', p_run_key,
    'source_rows', v_input_rows,
    'newly_staged_rows', v_newly_staged,
    'already_staged_identical_rows', v_already_staged,
    'capture_error_rows', v_capture_errors
  );

  INSERT INTO wf_canonical_staging.mariadb_raw_import_batches (
    batch_token, run_key, first_source_id, last_source_id, source_rows,
    newly_staged_rows, already_staged_identical_rows, capture_error_rows, result
  ) VALUES (
    p_batch_token, p_run_key, v_first_source_id, v_last_source_id, v_input_rows,
    v_newly_staged, v_already_staged, v_capture_errors, v_result
  );

  RETURN v_result;
END;
;

REVOKE ALL ON FUNCTION public.ingest_mariadb_private_raw_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_private_raw_batch TO service_role;

-- 7. Verification Readback Stored Procedure
CREATE OR REPLACE FUNCTION public.verify_mariadb_private_raw_readback(
  p_source_ids TEXT[]
)
RETURNS TABLE (
  source_id TEXT,
  source_hash TEXT,
  raw_payload_text TEXT,
  hash_algorithm TEXT,
  canonicalization_version TEXT,
  source_created_on TEXT,
  source_updated_on TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS 
BEGIN
  RETURN QUERY
  SELECT 
    r.source_id,
    r.source_hash,
    r.raw_payload_text,
    r.hash_algorithm,
    r.canonicalization_version,
    r.source_created_on,
    r.source_updated_on
  FROM wf_canonical_staging.mariadb_raw_source_rows r
  WHERE r.source_id = ANY(p_source_ids);
END;
;

REVOKE ALL ON FUNCTION public.verify_mariadb_private_raw_readback FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_mariadb_private_raw_readback TO service_role;

-- 8. Error Ledger Query Stored Procedure
CREATE OR REPLACE FUNCTION public.get_mariadb_private_raw_errors(
  p_run_key TEXT
)
RETURNS TABLE (
  id UUID,
  run_key TEXT,
  batch_token TEXT,
  source_id TEXT,
  source_created_on TEXT,
  source_hash TEXT,
  raw_payload_text TEXT,
  raw_payload JSONB,
  error_reason TEXT,
  error_detail JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS 
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.run_key,
    e.batch_token,
    e.source_id,
    e.source_created_on,
    e.source_hash,
    e.raw_payload_text,
    e.raw_payload,
    e.error_reason,
    e.error_detail,
    e.created_at
  FROM wf_canonical_staging.mariadb_raw_import_errors e
  WHERE e.run_key = p_run_key;
END;
;

REVOKE ALL ON FUNCTION public.get_mariadb_private_raw_errors FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_private_raw_errors TO service_role;

-- 9. Checkpoint Finalization Stored Procedure
CREATE OR REPLACE FUNCTION public.finalize_mariadb_private_raw_checkpoint(
  p_run_key TEXT,
  p_expected_staged_rows BIGINT,
  p_expected_error_rows BIGINT,
  p_final_status TEXT DEFAULT 'RAW_STAGED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS 
DECLARE
  v_checkpoint wf_canonical_staging.mariadb_raw_import_checkpoints%ROWTYPE;
BEGIN
  IF p_final_status NOT IN ('RAW_STAGED', 'VERIFICATION_COMPLETE') THEN
    RAISE EXCEPTION 'Invalid final status: %', p_final_status;
  END IF;

  SELECT * INTO v_checkpoint
  FROM wf_canonical_staging.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkpoint not found for run_key %', p_run_key;
  END IF;

  IF (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows) <> p_expected_staged_rows THEN
    RAISE EXCEPTION 'Staged rows mismatch: checkpoint has %, expected %',
      (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows), p_expected_staged_rows;
  END IF;

  IF v_checkpoint.capture_error_rows <> p_expected_error_rows THEN
    RAISE EXCEPTION 'Error rows mismatch: checkpoint has %, expected %',
      v_checkpoint.capture_error_rows, p_expected_error_rows;
  END IF;

  UPDATE wf_canonical_staging.mariadb_raw_import_checkpoints
  SET status = p_final_status,
      completed_at = now(),
      updated_at = now()
  WHERE run_key = p_run_key;

  RETURN jsonb_build_object(
    'status', 'FINALIZED',
    'run_key', p_run_key,
    'checkpoint_status', p_final_status,
    'total_staged_rows', (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows),
    'capture_error_rows', v_checkpoint.capture_error_rows,
    'completed_at', now()
  );
END;
;

REVOKE ALL ON FUNCTION public.finalize_mariadb_private_raw_checkpoint FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_mariadb_private_raw_checkpoint TO service_role;

-- 10. PostgreSQL Security Audit Stored Procedure
CREATE OR REPLACE FUNCTION public.audit_mariadb_private_raw_security()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, public, pg_catalog
AS 
DECLARE
  v_report JSONB;
BEGIN
  v_report := jsonb_build_object(
    'schema_privileges', jsonb_build_object(
      'anon_usage', has_schema_privilege('anon', 'wf_canonical_staging', 'USAGE'),
      'authenticated_usage', has_schema_privilege('authenticated', 'wf_canonical_staging', 'USAGE'),
      'service_role_usage', has_schema_privilege('service_role', 'wf_canonical_staging', 'USAGE')
    ),
    'table_privileges', jsonb_build_object(
      'mariadb_raw_source_rows', jsonb_build_object(
        'anon_select', has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'anon_insert', has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'INSERT'),
        'authenticated_select', has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'service_role_select', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'service_role_insert', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'INSERT'),
        'service_role_update', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'UPDATE'),
        'service_role_delete', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'DELETE')
      ),
      'mariadb_raw_import_checkpoints', jsonb_build_object(
        'anon_select', has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'SELECT'),
        'service_role_select', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'SELECT'),
        'service_role_insert', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'INSERT'),
        'service_role_update', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'UPDATE')
      ),
      'mariadb_raw_import_batches', jsonb_build_object(
        'anon_select', has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'SELECT'),
        'service_role_select', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'SELECT'),
        'service_role_insert', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'INSERT')
      ),
      'mariadb_raw_import_errors', jsonb_build_object(
        'anon_select', has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'SELECT'),
        'service_role_select', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'SELECT'),
        'service_role_insert', has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'INSERT')
      )
    ),
    'function_privileges', jsonb_build_object(
      'ingest_batch', jsonb_build_object(
        'anon_execute', has_function_privilege('anon', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb)', 'EXECUTE'),
        'authenticated_execute', has_function_privilege('authenticated', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb)', 'EXECUTE'),
        'service_role_execute', has_function_privilege('service_role', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
      ),
      'verify_readback', jsonb_build_object(
        'anon_execute', has_function_privilege('anon', 'public.verify_mariadb_private_raw_readback(text[])', 'EXECUTE'),
        'service_role_execute', has_function_privilege('service_role', 'public.verify_mariadb_private_raw_readback(text[])', 'EXECUTE')
      ),
      'get_errors', jsonb_build_object(
        'anon_execute', has_function_privilege('anon', 'public.get_mariadb_private_raw_errors(text)', 'EXECUTE'),
        'service_role_execute', has_function_privilege('service_role', 'public.get_mariadb_private_raw_errors(text)', 'EXECUTE')
      ),
      'finalize_checkpoint', jsonb_build_object(
        'anon_execute', has_function_privilege('anon', 'public.finalize_mariadb_private_raw_checkpoint(text,bigint,bigint,text)', 'EXECUTE'),
        'service_role_execute', has_function_privilege('service_role', 'public.finalize_mariadb_private_raw_checkpoint(text,bigint,bigint,text)', 'EXECUTE')
      )
    )
  );

  RETURN v_report;
END;
;

REVOKE ALL ON FUNCTION public.audit_mariadb_private_raw_security FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_mariadb_private_raw_security TO service_role;

COMMIT;
