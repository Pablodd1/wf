BEGIN;

-- Picker counts come from the complete frozen publication, not a loaded page.
-- They are evidence counts, never averages across unresolved conditions.
CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_dial_facets(
  p_snapshot_id uuid,
  p_brand text,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS TABLE (dial_color text, listing_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  RETURN QUERY
  SELECT v.dial_color, count(*)::bigint
  FROM wf_canonical_staging.keyset_snapshot_members member
  CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(
    NULL::public.trading_floor_ready_view_v2, member.payload
  ) v
  WHERE member.snapshot_id = p_snapshot_id
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  GROUP BY v.dial_color
  ORDER BY count(*) DESC, v.dial_color ASC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_dial_facets(uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_dial_facets(uuid,text,text,text,text,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
