-- Keep the later-brand database read inside the proven 51-row indexed window.
--
-- Cursor stability is enforced by the API advancing by the consumed source
-- window rather than by the number of rendered cards. Applying every identity
-- predicate before LIMIT caused a full filtered scan and exceeded the live
-- statement timeout; this forward replacement deliberately stays bounded.

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
    51,
    GREATEST(COALESCE(p_offset, 0), 0),
    p_listing_type
  ) AS source
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      upper(COALESCE(source.row_data->>'normalized_reference', '')),
      '[^A-Z0-9]', '', 'g'
    ) AS reference_key
  ) AS normalized
  WHERE (
    p_brand = 'Richard Mille'
    AND normalized.reference_key ~ '^RM[0-9]{3,6}[A-Z]{0,3}$'
  ) OR (
    p_brand = 'Cartier'
    AND normalized.reference_key ~ '^W[A-Z0-9]{5,18}$'
    AND normalized.reference_key ~ '[0-9]'
  )
  ORDER BY source.row_data->>'normalized_reference', source.row_data->>'id'
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_page_rows_strict(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_page_rows_strict(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
