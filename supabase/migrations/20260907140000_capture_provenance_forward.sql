-- Preserve historical migrations. Runtime additions belong only here.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Correct the historical grant's extra text argument. The copy RPC stays
-- service-only and its implementation/source evidence remain unchanged.
REVOKE ALL ON FUNCTION public.ingest_mariadb_raw_batch(text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mariadb_raw_batch(text,text,text,text,text,text,text,jsonb) TO service_role;
ALTER TABLE wf_canonical_staging.mariadb_raw_source_rows ADD COLUMN IF NOT EXISTS test_run_id varchar(64);
CREATE OR REPLACE FUNCTION public.get_mariadb_private_staged_auctions_batch(
  p_limit INT DEFAULT 1000,
  p_last_created_on TEXT DEFAULT NULL,
  p_last_source_id TEXT DEFAULT NULL,
  p_max_created_on TEXT DEFAULT '2026-04-28T15:50:43.000Z',
  p_max_source_id TEXT DEFAULT '3cddaf9f-9f36-4633-a08e-59a6dfdca057',
  p_source_system TEXT DEFAULT 'OceanDigital MariaDB',
  p_source_database TEXT DEFAULT 'thecollective_inventory',
  p_source_table TEXT DEFAULT 'auctions'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;
  IF (p_last_created_on IS NULL) <> (p_last_source_id IS NULL)
     OR p_max_created_on IS NULL OR p_max_source_id IS NULL THEN
    RAISE EXCEPTION 'invalid_capture_boundary' USING ERRCODE = '22023';
  END IF;
  IF p_last_created_on IS NULL OR p_last_source_id IS NULL THEN
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at, r.raw_message_source, r.raw_sha256,
        r.hash_algorithm, r.canonicalization_version
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on < p_max_created_on 
          OR (r.source_created_on = p_max_created_on AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  ELSE
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at, r.raw_message_source, r.raw_sha256,
        r.hash_algorithm, r.canonicalization_version
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on > p_last_created_on 
          OR (r.source_created_on = p_last_created_on AND r.source_id > p_last_source_id)
        )
        AND (
          r.source_created_on < p_max_created_on 
          OR (r.source_created_on = p_max_created_on AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  END IF;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;
-- Explicit identity arguments avoid the historical ambiguous overload grants.
REVOKE ALL ON FUNCTION public.get_mariadb_private_staged_auctions_batch(integer,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_private_staged_auctions_batch(integer,text,text,text,text,text,text,text) TO service_role;
COMMIT;
