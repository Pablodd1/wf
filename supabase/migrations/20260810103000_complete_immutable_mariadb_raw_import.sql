-- Forward-only completion for the partially applied immutable MariaDB raw-import
-- control plane. The preceding migration stopped after creating the ingest RPC
-- because its GRANT statement named an incorrect overload.
--
-- This migration does not normalize listings and does not write watch_records.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.raw_message_versions') IS NULL
    OR to_regclass('public.mariadb_raw_import_checkpoints') IS NULL
    OR to_regclass('public.mariadb_raw_import_batches') IS NULL
    OR to_regprocedure(
      'public.ingest_mariadb_raw_batch(text,text,text,text,text,text,text,jsonb)'
    ) IS NULL THEN
    RAISE EXCEPTION 'immutable MariaDB raw-import prerequisites are incomplete';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_mariadb_raw_batch(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_raw_batch(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

COMMENT ON TABLE public.raw_message_versions IS
  'Immutable MariaDB source snapshots. Each changed source row creates a new version; no normalized claim is stored here.';
COMMENT ON FUNCTION public.ingest_mariadb_raw_batch(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS
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
  IF v_checkpoint.input_rows
      <> v_checkpoint.version_rows_inserted + v_checkpoint.version_rows_existing
    OR v_checkpoint.error_rows <> 0 THEN
    RAISE EXCEPTION 'raw-import version counts do not reconcile for run %', p_run_key;
  END IF;

  UPDATE public.mariadb_raw_import_checkpoints
  SET status = 'RAW_COPY_COMPLETE',
      completed_at = now(),
      updated_at = now()
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

REVOKE ALL ON FUNCTION public.complete_mariadb_raw_import(
  TEXT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mariadb_raw_import(
  TEXT, BIGINT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.complete_mariadb_raw_import(
  TEXT, BIGINT, TEXT, TEXT
) IS
  'Closes an exactly reconciled immutable MariaDB raw-copy run. Does not normalize or publish listings.';

COMMIT;
