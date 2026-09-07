-- One approved dealer population with a rated subset and exact scoped totals.
BEGIN;
CREATE FUNCTION public.get_approved_dealer_directory(
  p_search text DEFAULT NULL, p_rated boolean DEFAULT false,
  p_limit integer DEFAULT 24, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_offset IS NULL OR p_offset<0
    OR p_rated IS NULL OR length(p_search)>100 THEN
    RAISE EXCEPTION 'invalid_directory_query' USING ERRCODE='22023';
  END IF;
  WITH scoped AS (
    SELECT d.* FROM public.dealers d WHERE d.status='VERIFIED' AND (
      NULLIF(btrim(p_search),'') IS NULL
      OR strpos(lower(COALESCE(d.display_name,'')),lower(btrim(p_search)))>0
      OR strpos(lower(COALESCE(d.company_name,'')),lower(btrim(p_search)))>0
      OR strpos(lower(COALESCE(d.city,'')),lower(btrim(p_search)))>0
      OR (d.contact_consent AND public.normalize_seller_phone_identity(p_search) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.dealer_source_identities i WHERE i.dealer_id=d.id
          AND i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
          AND public.normalize_seller_phone_identity(i.source_identity)=public.normalize_seller_phone_identity(p_search)
      ))
    )
  ), filtered AS (
    SELECT * FROM scoped WHERE NOT p_rated OR review_count>0
  ), page AS (
    SELECT * FROM filtered
    ORDER BY CASE WHEN p_rated THEN rating END DESC NULLS LAST,
      CASE WHEN p_rated THEN review_count END DESC NULLS LAST,
      lower(COALESCE(display_name,company_name,'')),id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'total',(SELECT count(*) FROM filtered),
    'all_total',(SELECT count(*) FROM scoped),
    'rated_total',(SELECT count(*) FROM scoped WHERE review_count>0),
    'dealers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'slug',slug,'display_name',display_name,'company_name',company_name,
      'country_code',country_code,'city',city,
      'rating',CASE WHEN review_count>0 THEN rating ELSE NULL END,'review_count',review_count,
      'whatsapp_group_count',whatsapp_group_count,'avatar_url',avatar_url,
      'profile_summary',profile_summary,'verified_at',verified_at,'member_since',member_since,
      'source_system','WATCHFACTS_VERIFIED_DEALERS',
      'listing_linkage_status','PENDING_EXACT_LISTING_LINKAGE','stats',NULL
    ) ORDER BY CASE WHEN p_rated THEN rating END DESC NULLS LAST,
      CASE WHEN p_rated THEN review_count END DESC NULLS LAST,
      lower(COALESCE(display_name,company_name,'')),id) FROM page),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_approved_dealer_directory(text,boolean,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_dealer_directory(text,boolean,integer,integer) TO service_role;
COMMIT;
