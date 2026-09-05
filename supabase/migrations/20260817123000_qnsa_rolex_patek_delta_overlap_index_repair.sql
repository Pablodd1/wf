-- Forward-only repair for the Rolex/Patek delta overlap audit. Keep casts on
-- the small request inputs so PostgreSQL can use the native UUID/VARCHAR
-- indexes on the large canonical staging and raw tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.qnsa_rolex_patek_delta_overlap(
  p_listing_ids text[], p_lineage jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, staging, raw
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
    WITH wanted AS MATERIALIZED (
      SELECT source_platform, source_group_id, source_message_id, payload_checksum
      FROM jsonb_to_recordset($2) AS x(
        source_platform varchar(50),
        source_group_id varchar(100),
        source_message_id varchar(100),
        payload_checksum varchar(64)
      )
    ), raw_matches AS MATERIALIZED (
      SELECT DISTINCT p.source_message_id, p.payload_checksum
      FROM wanted w
      JOIN raw.payloads p
       ON p.payload_checksum = w.payload_checksum
       AND p.source_platform = w.source_platform
       AND p.source_group_id IS NOT DISTINCT FROM w.source_group_id
       AND p.source_message_id = w.source_message_id
    )
    SELECT jsonb_build_object(
      'listing_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT l.id::text)
        FROM staging.listings l
        WHERE l.id = ANY($1::uuid[])
      ), '[]'::jsonb),
      'source_message_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT source_message_id::text) FROM raw_matches
      ), '[]'::jsonb),
      'payload_checksums', COALESCE((
        SELECT jsonb_agg(DISTINCT payload_checksum::text) FROM raw_matches
      ), '[]'::jsonb)
    )
  $sql$ INTO v_result USING p_listing_ids, p_lineage;

  RETURN COALESCE(v_result, jsonb_build_object(
    'listing_ids','[]'::jsonb,
    'source_message_ids','[]'::jsonb,
    'payload_checksums','[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_rolex_patek_delta_overlap(text[],jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_rolex_patek_delta_overlap(text[],jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
