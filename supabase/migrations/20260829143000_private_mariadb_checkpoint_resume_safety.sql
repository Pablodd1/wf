-- Forward-only migration: Checkpoint Resume Safety, Explicit 10-Parameter Ingestion Signature, and Full 84-Action Security Audit
-- Migration ID: 20260829143000_private_mariadb_checkpoint_resume_safety

BEGIN;

-- 1. Extend Checkpoint Table Schema
ALTER TABLE wf_canonical_staging.mariadb_raw_import_checkpoints 
  ADD COLUMN IF NOT EXISTS frozen_manifest JSONB,
  ADD COLUMN IF NOT EXISTS frozen_upper_boundary JSONB,
  ADD COLUMN IF NOT EXISTS manifest_sha256 TEXT;

-- 2. Drop any legacy overloads of ingest_mariadb_private_raw_batch
DROP FUNCTION IF EXISTS public.ingest_mariadb_private_raw_batch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ingest_mariadb_private_raw_batch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT);

-- 3. Dedicated Checkpoint Retrieval Stored Procedure (Service-Role Only)
CREATE OR REPLACE FUNCTION public.get_mariadb_private_raw_checkpoint(
  p_run_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_cp wf_canonical_staging.mariadb_raw_import_checkpoints%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' THEN
    RAISE EXCEPTION 'run_key is required';
  END IF;

  SELECT * INTO v_cp
  FROM wf_canonical_staging.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'run_key', v_cp.run_key,
    'contract', v_cp.contract,
    'last_created_on', v_cp.last_created_on,
    'last_source_id', v_cp.last_source_id,
    'input_rows', v_cp.input_rows,
    'newly_staged_rows', v_cp.newly_staged_rows,
    'already_staged_identical_rows', v_cp.already_staged_identical_rows,
    'capture_error_rows', v_cp.capture_error_rows,
    'status', v_cp.status,
    'frozen_manifest', v_cp.frozen_manifest,
    'frozen_upper_boundary', v_cp.frozen_upper_boundary,
    'manifest_sha256', v_cp.manifest_sha256,
    'started_at', v_cp.started_at,
    'updated_at', v_cp.updated_at,
    'completed_at', v_cp.completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mariadb_private_raw_checkpoint(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_private_raw_checkpoint(TEXT) TO service_role;

-- 4. Explicit 10-Parameter Ingestion Stored Procedure
CREATE OR REPLACE FUNCTION public.ingest_mariadb_private_raw_batch(
  p_run_key TEXT,
  p_batch_token TEXT,
  p_contract TEXT,
  p_expected_last_created_on TEXT,
  p_expected_last_source_id TEXT,
  p_next_last_created_on TEXT,
  p_next_last_source_id TEXT,
  p_records JSONB,
  p_frozen_upper_boundary JSONB,
  p_manifest_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog, extensions
AS $$
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
  v_resolved_upper_boundary JSONB;
  v_resolved_manifest JSONB;
BEGIN
  IF COALESCE(btrim(p_run_key), '') = '' OR COALESCE(btrim(p_batch_token), '') = '' THEN
    RAISE EXCEPTION 'run_key and batch_token are required';
  END IF;

  IF p_contract <> 'wf-mariadb-private-raw-staging-v1' THEN
    RAISE EXCEPTION 'Unsupported contract: %', p_contract;
  END IF;

  IF p_frozen_upper_boundary IS NULL OR p_manifest_sha256 IS NULL THEN
    RAISE EXCEPTION 'p_frozen_upper_boundary and p_manifest_sha256 are mandatory parameters';
  END IF;

  -- Resolve upper boundary vs full manifest structure
  IF p_frozen_upper_boundary ? 'upper_boundary' THEN
    v_resolved_manifest := p_frozen_upper_boundary;
    v_resolved_upper_boundary := p_frozen_upper_boundary->'upper_boundary';
  ELSE
    v_resolved_manifest := pg_catalog.jsonb_build_object('upper_boundary', p_frozen_upper_boundary);
    v_resolved_upper_boundary := p_frozen_upper_boundary;
  END IF;

  -- Check if batch was already applied
  SELECT * INTO v_batch
  FROM wf_canonical_staging.mariadb_raw_import_batches
  WHERE batch_token = p_batch_token;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
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
      newly_staged_rows, already_staged_identical_rows, capture_error_rows, status,
      frozen_manifest, frozen_upper_boundary, manifest_sha256
    ) VALUES (
      p_run_key, p_contract, COALESCE(p_expected_last_created_on, ''), COALESCE(p_expected_last_source_id, ''), 0,
      0, 0, 0, 'COPYING_RAW',
      v_resolved_manifest, v_resolved_upper_boundary, p_manifest_sha256
    ) RETURNING * INTO v_checkpoint;
  ELSE
    -- On subsequent batches, reject any boundary or manifest hash different from checkpoint
    IF v_checkpoint.manifest_sha256 IS DISTINCT FROM p_manifest_sha256 THEN
      RAISE EXCEPTION 'Manifest hash mismatch: checkpoint has %, batch provided %',
        v_checkpoint.manifest_sha256, p_manifest_sha256;
    END IF;
    IF v_checkpoint.frozen_upper_boundary IS DISTINCT FROM v_resolved_upper_boundary THEN
      RAISE EXCEPTION 'Frozen upper boundary mismatch: checkpoint has %, batch provided %',
        v_checkpoint.frozen_upper_boundary, v_resolved_upper_boundary;
    END IF;
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
  FOR v_record IN SELECT * FROM pg_catalog.jsonb_array_elements(p_records) LOOP
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
      v_captured_at := COALESCE((v_record->>'captured_at')::timestamptz, pg_catalog.now());
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

      IF v_source_id IS NULL OR v_source_hash IS NULL OR v_raw_payload_text IS NULL OR v_raw_payload IS NULL THEN
        RAISE EXCEPTION 'Missing mandatory identity fields: source_id, source_hash, raw_payload_text, or raw_payload';
      END IF;

      -- Enforce Supported Algorithm & Canonicalization Version
      IF v_hash_algo <> 'sha256' THEN
        RAISE EXCEPTION 'Unsupported hash algorithm: % (expected sha256)', v_hash_algo;
      END IF;

      IF v_canon_version <> 'v1-json-keys-sorted-compact' THEN
        RAISE EXCEPTION 'Unsupported canonicalization version: % (expected v1-json-keys-sorted-compact)', v_canon_version;
      END IF;

      -- Enforce Semantic JSON Equivalence
      IF v_raw_payload_text::jsonb <> v_raw_payload THEN
        RAISE EXCEPTION 'Semantic JSON mismatch: raw_payload_text::jsonb does not equal raw_payload JSONB';
      END IF;

      -- Database-Side Cryptographic SHA-256 Verification using extensions.digest & convert_to
      v_computed_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_payload_text, 'UTF8'), 'sha256'), 'hex');
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
          v_raw_message, v_raw_message_source, v_raw_sha256, v_raw_payload_text, v_raw_payload,
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
        pg_catalog.jsonb_build_object('sqlstate', SQLSTATE, 'record_sample', v_record)
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
      updated_at = pg_catalog.now()
  WHERE run_key = p_run_key;

  -- Record Batch Execution
  v_result := pg_catalog.jsonb_build_object(
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
$$;

REVOKE ALL ON FUNCTION public.ingest_mariadb_private_raw_batch(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_private_raw_batch(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) TO service_role;

-- 5. Checkpoint Finalization Stored Procedure with Strict Totals and Boundary Verification
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
AS $$
DECLARE
  v_checkpoint wf_canonical_staging.mariadb_raw_import_checkpoints%ROWTYPE;
  v_total_source_rows BIGINT;
BEGIN
  IF p_final_status NOT IN ('RAW_STAGED', 'VERIFICATION_COMPLETE', 'PARTIAL') THEN
    RAISE EXCEPTION 'Invalid final status: %', p_final_status;
  END IF;

  SELECT * INTO v_checkpoint
  FROM wf_canonical_staging.mariadb_raw_import_checkpoints
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkpoint not found for run_key %', p_run_key;
  END IF;

  -- 1. Invariant: Staged rows match expectation
  IF (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows) <> p_expected_staged_rows THEN
    RAISE EXCEPTION 'Staged rows mismatch: checkpoint has %, expected %',
      (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows), p_expected_staged_rows;
  END IF;

  -- 2. Invariant: Error rows match expectation
  IF v_checkpoint.capture_error_rows <> p_expected_error_rows THEN
    RAISE EXCEPTION 'Error rows mismatch: checkpoint has %, expected %',
      v_checkpoint.capture_error_rows, p_expected_error_rows;
  END IF;

  -- 3. Core Reconciliation Formula Assertion: input_rows = staged + errors
  IF v_checkpoint.input_rows <> (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows + v_checkpoint.capture_error_rows) THEN
    RAISE EXCEPTION 'Reconciliation invariant failed: input_rows (%) <> staged (%) + errors (%)',
      v_checkpoint.input_rows,
      (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows),
      v_checkpoint.capture_error_rows;
  END IF;

  -- 4. Strict RAW_STAGED Boundary & Full Ingestion Invariants
  IF p_final_status = 'RAW_STAGED' THEN
    IF v_checkpoint.frozen_manifest IS NOT NULL AND (v_checkpoint.frozen_manifest ? 'total_source_rows') THEN
      v_total_source_rows := (v_checkpoint.frozen_manifest->>'total_source_rows')::bigint;
      IF v_checkpoint.input_rows <> v_total_source_rows THEN
        RAISE EXCEPTION 'Cannot finalize RAW_STAGED: input_rows (%) <> total_source_rows (%)',
          v_checkpoint.input_rows, v_total_source_rows;
      END IF;
    END IF;

    IF v_checkpoint.frozen_upper_boundary IS NOT NULL THEN
      IF v_checkpoint.last_source_id <> (v_checkpoint.frozen_upper_boundary->>'id') OR
         v_checkpoint.last_created_on <> (v_checkpoint.frozen_upper_boundary->>'created_on') THEN
        RAISE EXCEPTION 'Cannot finalize RAW_STAGED: final cursor (%, %) does not match frozen upper boundary (%, %)',
          v_checkpoint.last_created_on, v_checkpoint.last_source_id,
          v_checkpoint.frozen_upper_boundary->>'created_on', v_checkpoint.frozen_upper_boundary->>'id';
      END IF;
    END IF;
  END IF;

  -- Update Checkpoint Final Status
  UPDATE wf_canonical_staging.mariadb_raw_import_checkpoints
  SET status = p_final_status,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE run_key = p_run_key;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'FINALIZED',
    'run_key', p_run_key,
    'checkpoint_status', p_final_status,
    'total_staged_rows', (v_checkpoint.newly_staged_rows + v_checkpoint.already_staged_identical_rows),
    'capture_error_rows', v_checkpoint.capture_error_rows,
    'input_rows', v_checkpoint.input_rows,
    'completed_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_mariadb_private_raw_checkpoint(TEXT,BIGINT,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_mariadb_private_raw_checkpoint(TEXT,BIGINT,BIGINT,TEXT) TO service_role;

-- 6. Comprehensive 84-Action Direct Table Security Audit RPC
CREATE OR REPLACE FUNCTION public.audit_mariadb_private_raw_security()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_report JSONB;
BEGIN
  v_report := pg_catalog.jsonb_build_object(
    'schema_usage', pg_catalog.jsonb_build_object(
      'anon', pg_catalog.has_schema_privilege('anon', 'wf_canonical_staging', 'USAGE'),
      'authenticated', pg_catalog.has_schema_privilege('authenticated', 'wf_canonical_staging', 'USAGE'),
      'service_role', pg_catalog.has_schema_privilege('service_role', 'wf_canonical_staging', 'USAGE')
    ),
    'direct_table_privileges', pg_catalog.jsonb_build_object(
      'mariadb_raw_source_rows', pg_catalog.jsonb_build_object(
        'anon_select', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'anon_insert', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'INSERT'),
        'anon_update', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'UPDATE'),
        'anon_delete', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'DELETE'),
        'anon_truncate', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRUNCATE'),
        'anon_references', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'REFERENCES'),
        'anon_trigger', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRIGGER'),
        'authenticated_select', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'authenticated_insert', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'INSERT'),
        'authenticated_update', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'UPDATE'),
        'authenticated_delete', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'DELETE'),
        'authenticated_truncate', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRUNCATE'),
        'authenticated_references', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'REFERENCES'),
        'authenticated_trigger', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRIGGER'),
        'service_role_select', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'SELECT'),
        'service_role_insert', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'INSERT'),
        'service_role_update', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'UPDATE'),
        'service_role_delete', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'DELETE'),
        'service_role_truncate', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRUNCATE'),
        'service_role_references', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'REFERENCES'),
        'service_role_trigger', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_source_rows', 'TRIGGER')
      ),
      'mariadb_raw_import_checkpoints', pg_catalog.jsonb_build_object(
        'anon_select', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'SELECT'),
        'anon_insert', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'INSERT'),
        'anon_update', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'UPDATE'),
        'anon_delete', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'DELETE'),
        'anon_truncate', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRUNCATE'),
        'anon_references', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'REFERENCES'),
        'anon_trigger', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRIGGER'),
        'authenticated_select', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'SELECT'),
        'authenticated_insert', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'INSERT'),
        'authenticated_update', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'UPDATE'),
        'authenticated_delete', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'DELETE'),
        'authenticated_truncate', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRUNCATE'),
        'authenticated_references', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'REFERENCES'),
        'authenticated_trigger', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRIGGER'),
        'service_role_select', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'SELECT'),
        'service_role_insert', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'INSERT'),
        'service_role_update', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'UPDATE'),
        'service_role_delete', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'DELETE'),
        'service_role_truncate', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRUNCATE'),
        'service_role_references', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'REFERENCES'),
        'service_role_trigger', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_checkpoints', 'TRIGGER')
      ),
      'mariadb_raw_import_batches', pg_catalog.jsonb_build_object(
        'anon_select', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'SELECT'),
        'anon_insert', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'INSERT'),
        'anon_update', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'UPDATE'),
        'anon_delete', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'DELETE'),
        'anon_truncate', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRUNCATE'),
        'anon_references', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'REFERENCES'),
        'anon_trigger', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRIGGER'),
        'authenticated_select', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'SELECT'),
        'authenticated_insert', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'INSERT'),
        'authenticated_update', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'UPDATE'),
        'authenticated_delete', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'DELETE'),
        'authenticated_truncate', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRUNCATE'),
        'authenticated_references', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'REFERENCES'),
        'authenticated_trigger', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRIGGER'),
        'service_role_select', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'SELECT'),
        'service_role_insert', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'INSERT'),
        'service_role_update', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'UPDATE'),
        'service_role_delete', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'DELETE'),
        'service_role_truncate', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRUNCATE'),
        'service_role_references', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'REFERENCES'),
        'service_role_trigger', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_batches', 'TRIGGER')
      ),
      'mariadb_raw_import_errors', pg_catalog.jsonb_build_object(
        'anon_select', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'SELECT'),
        'anon_insert', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'INSERT'),
        'anon_update', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'UPDATE'),
        'anon_delete', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'DELETE'),
        'anon_truncate', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRUNCATE'),
        'anon_references', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'REFERENCES'),
        'anon_trigger', pg_catalog.has_table_privilege('anon', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRIGGER'),
        'authenticated_select', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'SELECT'),
        'authenticated_insert', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'INSERT'),
        'authenticated_update', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'UPDATE'),
        'authenticated_delete', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'DELETE'),
        'authenticated_truncate', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRUNCATE'),
        'authenticated_references', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'REFERENCES'),
        'authenticated_trigger', pg_catalog.has_table_privilege('authenticated', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRIGGER'),
        'service_role_select', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'SELECT'),
        'service_role_insert', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'INSERT'),
        'service_role_update', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'UPDATE'),
        'service_role_delete', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'DELETE'),
        'service_role_truncate', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRUNCATE'),
        'service_role_references', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'REFERENCES'),
        'service_role_trigger', pg_catalog.has_table_privilege('service_role', 'wf_canonical_staging.mariadb_raw_import_errors', 'TRIGGER')
      )
    ),
    'function_privileges', pg_catalog.jsonb_build_object(
      'get_checkpoint', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.get_mariadb_private_raw_checkpoint(text)', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.get_mariadb_private_raw_checkpoint(text)', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.get_mariadb_private_raw_checkpoint(text)', 'EXECUTE')
      ),
      'ingest_batch', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb,jsonb,text)', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb,jsonb,text)', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.ingest_mariadb_private_raw_batch(text,text,text,text,text,text,text,jsonb,jsonb,text)', 'EXECUTE')
      ),
      'verify_readback', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.verify_mariadb_private_raw_readback(text[])', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.verify_mariadb_private_raw_readback(text[])', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.verify_mariadb_private_raw_readback(text[])', 'EXECUTE')
      ),
      'get_errors', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.get_mariadb_private_raw_errors(text)', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.get_mariadb_private_raw_errors(text)', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.get_mariadb_private_raw_errors(text)', 'EXECUTE')
      ),
      'finalize_checkpoint', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.finalize_mariadb_private_raw_checkpoint(text,bigint,bigint,text)', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.finalize_mariadb_private_raw_checkpoint(text,bigint,bigint,text)', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.finalize_mariadb_private_raw_checkpoint(text,bigint,bigint,text)', 'EXECUTE')
      ),
      'audit_security', pg_catalog.jsonb_build_object(
        'anon_execute', pg_catalog.has_function_privilege('anon', 'public.audit_mariadb_private_raw_security()', 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', 'public.audit_mariadb_private_raw_security()', 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', 'public.audit_mariadb_private_raw_security()', 'EXECUTE')
      )
    )
  );

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_mariadb_private_raw_security FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_mariadb_private_raw_security TO service_role;

COMMIT;
