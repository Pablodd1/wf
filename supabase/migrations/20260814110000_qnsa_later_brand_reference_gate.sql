-- Fail closed on obvious parser artifacts in the bounded later-brand feed.
-- The base function still enforces immutable lineage and publication safety;
-- this wrapper adds only a brand-specific reference-shape gate.

CREATE OR REPLACE FUNCTION public.qnsa_later_brand_page_rows_strict(
  p_brand TEXT,
  p_limit INTEGER DEFAULT 51,
  p_offset INTEGER DEFAULT 0,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS TABLE(row_data JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT source.row_data
  FROM public.qnsa_later_brand_page_rows(
    p_brand,
    101,
    GREATEST(COALESCE(p_offset, 0), 0),
    p_listing_type
  ) AS source
  WHERE (
    p_brand = 'Richard Mille'
    AND upper(COALESCE(source.row_data->>'normalized_reference', ''))
      ~ '^RM[0-9]{2,3}(-[0-9]{1,3})?$'
  ) OR (
    p_brand = 'Cartier'
    AND upper(COALESCE(source.row_data->>'normalized_reference', ''))
      ~ '^W[A-Z0-9]{5,15}$'
  )
  ORDER BY source.row_data->>'normalized_reference', source.row_data->>'id'
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101);
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_page_rows_strict(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_page_rows_strict(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
