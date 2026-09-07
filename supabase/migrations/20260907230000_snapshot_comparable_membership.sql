BEGIN;
-- Determine page labels using the whole exact cohort, including unseen reposts.
CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_membership(
  p_snapshot_id uuid, p_brand text, p_reference text, p_model text,
  p_dial_color text, p_condition text, p_listing_ids text[]
)
RETURNS TABLE (listing_id text, exclusion_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  IF cardinality(p_listing_ids) IS NULL OR cardinality(p_listing_ids) NOT BETWEEN 1 AND 100
    OR nullif(btrim(p_brand),'') IS NULL OR (nullif(btrim(p_reference),'') IS NULL AND nullif(btrim(p_model),'') IS NULL)
    OR nullif(btrim(p_dial_color),'') IS NULL OR nullif(btrim(p_condition),'') IS NULL THEN
    RAISE EXCEPTION 'Exact cohort and 1 to 100 listing identities required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT v.listing_id, v.price_usd, v.source_created_at,
      coalesce(nullif(v.duplicate_group_id,''), md5(
        coalesce(nullif(v.seller_id,''),nullif(v.seller_display_name,''),v.source_id,'UNKNOWN_SELLER') || '|' ||
        lower(trim(v.brand)) || '|' || lower(trim(coalesce(v.reference,v.model,''))) || '|' ||
        lower(trim(coalesce(v.dial_color,''))) || '|' || lower(trim(coalesce(v.condition,''))) || '|' ||
        round(coalesce(v.price_usd,0))::text
      )) AS group_key
    FROM wf_canonical_staging.keyset_snapshot_members member
    CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2,member.payload) v
    WHERE member.snapshot_id=p_snapshot_id AND v.intent='WTS'
      AND v.price_research_eligible IS TRUE AND v.included_in_statistics IS TRUE
      AND v.price_usd>0 AND v.price_usd NOT IN ('NaN'::numeric,'Infinity'::numeric)
      AND (upper(v.original_price_currency)='USD' OR (upper(v.original_price_currency)<>'USD'
        AND v.fx_rate>0 AND nullif(btrim(v.fx_source),'') IS NOT NULL AND v.fx_date IS NOT NULL))
      AND lower(v.brand)=lower(p_brand)
      AND (p_reference IS NULL OR lower(v.reference)=lower(p_reference))
      AND (p_model IS NULL OR lower(v.model)=lower(p_model))
      AND v.dial_color IS NOT DISTINCT FROM p_dial_color
      AND v.condition IS NOT DISTINCT FROM p_condition
  ), ranked AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.group_key ORDER BY c.source_created_at DESC,c.listing_id ASC) AS duplicate_rank
    FROM candidates c
  ), floor_calc AS (
    SELECT greatest(1000::numeric,round(percentile_cont(0.50) WITHIN GROUP (ORDER BY r.price_usd)::numeric*0.25)) AS floor
    FROM ranked r WHERE r.duplicate_rank=1
  ), quartiles AS (
    SELECT count(*) AS n,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY r.price_usd)::numeric AS q1,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY r.price_usd)::numeric AS q3
    FROM ranked r CROSS JOIN floor_calc f WHERE r.duplicate_rank=1 AND r.price_usd>=f.floor
  )
  SELECT r.listing_id,
    CASE WHEN r.duplicate_rank>1 THEN 'REPOST_DUPLICATE'
      WHEN r.price_usd<f.floor THEN 'BELOW_MARKET_PLAUSIBILITY_FLOOR'
      WHEN q.n<2 THEN 'INSUFFICIENT_COHORT'
      WHEN r.price_usd<greatest(0,q.q1-3.0*(q.q3-q.q1)) THEN 'BELOW_IQR_FENCE'
      WHEN r.price_usd>q.q3+3.0*(q.q3-q.q1) THEN 'ABOVE_IQR_FENCE'
      ELSE NULL END
  FROM ranked r CROSS JOIN floor_calc f CROSS JOIN quartiles q
  WHERE r.listing_id=ANY(p_listing_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_membership(uuid,text,text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_membership(uuid,text,text,text,text,text,text[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
