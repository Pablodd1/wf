-- Forward-only reliability correction for cold Richard Mille customer reads.
-- The candidate cursor advances by the exact scanned source window, so this
-- smaller stride changes page density only; it cannot repeat or skip rows.

CREATE OR REPLACE FUNCTION public.qnsa_later_brand_candidate_stride_page(
  p_brand TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  SELECT public.qnsa_later_brand_candidate_page(
    p_brand,
    GREATEST(COALESCE(p_offset, 0), 0),
    LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50),
    CASE WHEN p_brand = 'Richard Mille' THEN 4 ELSE 50 END,
    p_listing_type
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
IS 'Complete later-brand cursor: 4-candidate RM reliability stride, 50-candidate Cartier stride.';

NOTIFY pgrst, 'reload schema';
