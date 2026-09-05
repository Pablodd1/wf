-- Select and repair only normalized proposals whose deterministic hash is absent or malformed.
-- This lane cannot insert proposals and remains service-role-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_mariadb_proposals_missing_or_invalid_hash(
  p_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000';
  END IF;

  SELECT COALESCE(jsonb_agg(candidate.raw_row ORDER BY candidate.source_created_on, candidate.source_id), '[]'::JSONB)
  INTO v_rows
  FROM (
    SELECT
      jsonb_build_object(
        'id', r.id,
        'source_system', r.source_system,
        'source_database', r.source_database,
        'source_table', r.source_table,
        'source_id', r.source_id,
        'source_record_id', r.source_record_id,
        'source_created_on', r.source_created_on,
        'source_updated_on', r.source_updated_on,
        'source_hash', r.source_hash,
        'raw_message', r.raw_message,
        'raw_payload', r.raw_payload,
        'captured_at', r.captured_at
      ) AS raw_row,
      r.source_created_on,
      r.source_id
    FROM wf_canonical_staging.mariadb_normalized_proposals AS p
    INNER JOIN wf_canonical_staging.mariadb_raw_source_rows AS r
      ON r.source_system = p.source_system
     AND r.source_database = p.source_database
     AND r.source_table = p.source_table
     AND r.source_id = p.source_id
     AND r.source_hash = p.source_hash
    WHERE p.proposal_hash IS NULL
       OR p.proposal_hash !~ '^[0-9a-f]{64}$'
    ORDER BY r.source_created_on, r.source_id
    LIMIT p_limit
  ) AS candidate;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_mariadb_proposal_hashes(
  p_hashes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  elem JSONB;
  v_updated INTEGER := 0;
  v_missing INTEGER := 0;
  v_hash TEXT;
BEGIN
  IF p_hashes IS NULL OR jsonb_typeof(p_hashes) <> 'array' THEN
    RAISE EXCEPTION 'p_hashes must be a JSON array';
  END IF;

  FOR elem IN SELECT * FROM jsonb_array_elements(p_hashes)
  LOOP
    v_hash := elem->>'proposal_hash';
    IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'proposal_hash must be lowercase 64-character SHA-256 hex';
    END IF;

    UPDATE wf_canonical_staging.mariadb_normalized_proposals
    SET proposal_hash = v_hash,
        normalized_at = NOW()
    WHERE source_system = elem->>'source_system'
      AND source_database = elem->>'source_database'
      AND source_table = elem->>'source_table'
      AND source_id = elem->>'source_id'
      AND source_hash = elem->>'source_hash'
      AND (proposal_hash IS NULL OR proposal_hash !~ '^[0-9a-f]{64}$');

    IF FOUND THEN
      v_updated := v_updated + 1;
    ELSE
      v_missing := v_missing + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', 0,
    'updated', v_updated,
    'unchanged', 0,
    'missing', v_missing,
    'total', v_updated + v_missing
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mariadb_proposals_missing_or_invalid_hash(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_mariadb_proposal_hashes(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_proposals_missing_or_invalid_hash(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_mariadb_proposal_hashes(JSONB)
  TO service_role;

COMMIT;
