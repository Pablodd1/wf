-- Private immutable lineage for reviewed-workbook delta rows. These columns
-- remain service-only because the table has RLS and no anon/authenticated grant.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.reviewed_workbook_inventory
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_group_id text,
  ADD COLUMN IF NOT EXISTS source_message_id text;

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_delta_source_message
  ON public.reviewed_workbook_inventory (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reviewed_workbook_delta_release_runs (
  run_key text PRIMARY KEY,
  release_mode text NOT NULL CHECK (release_mode IN ('CANARY','FULL')),
  release_tier text NOT NULL CHECK (release_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'),
  status text NOT NULL CHECK (status IN ('RUNNING','APPLIED','ROLLED_BACK','FAILED')),
  workbook_sha256 jsonb NOT NULL,
  inserted_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  inserted_content_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(inserted_ids) = 'array'),
  CHECK (jsonb_typeof(inserted_content_hashes) = 'array')
);

ALTER TABLE public.reviewed_workbook_delta_release_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewed_workbook_delta_release_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_delta_release_runs TO service_role;

CREATE OR REPLACE FUNCTION public.qnsa_rolex_patek_delta_overlap(
  p_listing_ids text[], p_lineage jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, staging, jobs, raw
AS $$
DECLARE v_result jsonb;
BEGIN
  IF to_regclass('staging.listings') IS NULL
     OR to_regclass('raw.payloads') IS NULL THEN
    RAISE EXCEPTION 'canonical staging/raw lineage tables unavailable';
  END IF;
  IF jsonb_typeof(p_lineage) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'lineage must be a JSON array';
  END IF;
  EXECUTE $sql$
    WITH wanted AS (
      SELECT source_platform, source_group_id, source_message_id, payload_checksum
      FROM jsonb_to_recordset($2) AS x(
        source_platform text,
        source_group_id text,
        source_message_id text,
        payload_checksum text
      )
    ), raw_matches AS (
      SELECT DISTINCT p.source_message_id::text, p.payload_checksum::text
      FROM raw.payloads p
      JOIN wanted w
        ON p.source_platform::text = w.source_platform
       AND p.source_group_id::text = w.source_group_id
       AND p.source_message_id::text = w.source_message_id
       AND p.payload_checksum::text = w.payload_checksum
    )
    SELECT jsonb_build_object(
      'listing_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT l.id::text)
        FROM staging.listings l
        WHERE l.id::text = ANY($1)
      ), '[]'::jsonb),
      'source_message_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT source_message_id) FROM raw_matches
      ), '[]'::jsonb),
      'payload_checksums', COALESCE((
        SELECT jsonb_agg(DISTINCT payload_checksum) FROM raw_matches
      ), '[]'::jsonb)
    )
  $sql$ INTO v_result USING p_listing_ids, p_lineage;
  RETURN COALESCE(v_result, jsonb_build_object('listing_ids','[]'::jsonb,'source_message_ids','[]'::jsonb,'payload_checksums','[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_rolex_patek_delta_overlap(text[],jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_rolex_patek_delta_overlap(text[],jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rollback_qnsa_rolex_patek_delta(p_run_key text, p_ids text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer := 0;
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.reviewed_workbook_delta_release_runs
  WHERE run_key = p_run_key
    AND release_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'rollback run does not exist';
  ELSIF v_status = 'ROLLED_BACK' THEN
    RAISE EXCEPTION 'rollback run was already rolled back';
  ELSIF v_status NOT IN ('RUNNING', 'APPLIED') THEN
    RAISE EXCEPTION 'rollback run status % is not reversible', v_status;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) id WHERE id !~ '^rpdelta_[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'rollback contains invalid listing id';
  END IF;
  DELETE FROM public.reviewed_workbook_inventory
  WHERE id = ANY(p_ids)
    AND import_run_id = p_run_key
    AND verification_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  UPDATE public.reviewed_workbook_delta_release_runs
  SET status='ROLLED_BACK', updated_at=now() WHERE run_key=p_run_key;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_qnsa_rolex_patek_delta(text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_qnsa_rolex_patek_delta(text,text[]) TO service_role;

REVOKE ALL ON public.reviewed_workbook_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_inventory TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
