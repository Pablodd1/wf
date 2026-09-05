-- Forward-only latency correction for the later-brand candidate cursor.
--
-- The underlying candidate RPC has an exact source-offset contract when the
-- scan stride is bounded: it evaluates the first N candidates, advances by
-- exactly those N candidates, and uses candidate N+1 only as a cheap
-- lookahead. Calling it with 500 caused eligibility joins and JSON projection
-- across an unnecessarily large window. Keep the complete cursor semantics
-- while restoring the proven 50/51-row bound.

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
    50,
    p_listing_type
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
IS 'Complete later-brand source cursor with at most 50 eligibility joins plus one raw candidate lookahead per call.';

NOTIFY pgrst, 'reload schema';
