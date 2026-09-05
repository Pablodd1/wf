-- Forward-only latency correction for broad Richard Mille customer pages.
-- The cursor advances by the raw candidate window, so a smaller scan neither
-- repeats nor skips candidates. Cartier retains its proven 50-row stride.

DO $$
DECLARE
  v_signature regprocedure := 'public.qnsa_later_brand_candidate_page(text,integer,integer,integer,text)'::regprocedure;
  v_definition text;
  v_rewritten text;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  v_rewritten := regexp_replace(
    v_definition,
    'GREATEST\(COALESCE\(p_scan_limit,\s*500\),\s*50\)',
    'GREATEST(COALESCE(p_scan_limit, 500), 1)'
  );
  IF v_rewritten = v_definition THEN
    RAISE EXCEPTION 'Expected candidate scan-limit clamp was not found';
  END IF;
  EXECUTE v_rewritten;
END;
$$;

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
    CASE WHEN p_brand = 'Richard Mille' THEN 12 ELSE 50 END,
    p_listing_type
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT, INTEGER, INTEGER, TEXT)
IS 'Complete later-brand cursor: 12-candidate RM stride for hosted latency, 50-candidate Cartier stride.';

NOTIFY pgrst, 'reload schema';
