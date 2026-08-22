-- Model-scoped Zenith browsing reuses the exact-reference release function.
-- The public API supplies only catalog references for the selected model.

BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_zenith_model_page_rows(
  p_references text[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 51,
  p_listing_type text DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT btrim(value) AS reference
    FROM unnest(COALESCE(p_references, ARRAY[]::text[])) AS value
    WHERE NULLIF(btrim(value), '') IS NOT NULL
    LIMIT 50
  ), rows AS MATERIALIZED (
    SELECT released.row_data
    FROM requested
    CROSS JOIN LATERAL public.qnsa_zenith_reference_rows(
      requested.reference, 0, 101, p_listing_type
    ) AS released(row_data)
  )
  SELECT row_data FROM rows
  ORDER BY COALESCE((row_data->>'has_exact_source_image')::boolean, false) DESC,
    COALESCE((row_data->>'has_verified_usd_price')::boolean, false) DESC,
    (row_data->>'posting_date')::timestamptz DESC,
    row_data->>'id' DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.qnsa_zenith_model_release_count(
  p_references text[], p_listing_type text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT btrim(value) AS reference
    FROM unnest(COALESCE(p_references, ARRAY[]::text[])) AS value
    WHERE NULLIF(btrim(value), '') IS NOT NULL
    LIMIT 50
  )
  SELECT count(*)
  FROM requested
  CROSS JOIN LATERAL public.qnsa_zenith_reference_rows(
    requested.reference, 0, 101, p_listing_type
  ) AS released(row_data);
$$;

REVOKE ALL ON FUNCTION public.qnsa_zenith_model_page_rows(text[],integer,integer,text),
  public.qnsa_zenith_model_release_count(text[],text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_zenith_model_page_rows(text[],integer,integer,text),
  public.qnsa_zenith_model_release_count(text[],text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
