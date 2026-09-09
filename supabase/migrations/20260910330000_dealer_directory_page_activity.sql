-- Proposed function-only change. No production execution authority.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE p record;
BEGIN
 SELECT pg_get_functiondef(oid) definition,proacl::text acl,prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) owner
 INTO STRICT p FROM pg_proc WHERE oid='public.get_approved_dealer_directory(text,boolean,integer,integer)'::regprocedure;
 IF encode(sha256(convert_to(p.definition,'UTF8')),'hex') <> '74b74397871c08a083753503b62f722d9b4fe1564a8430902a14eb0f7147f933'
 THEN RAISE EXCEPTION 'dealer_directory_previous_definition_changed' USING ERRCODE='22023'; END IF;
 IF p.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's'::"char"
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR p.owner IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'dealer_directory_permissions_changed' USING ERRCODE='22023'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_approved_dealer_directory(p_search text DEFAULT NULL::text, p_rated boolean DEFAULT false, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 OR p_rated IS NULL OR length(p_search)>100 THEN
  RAISE EXCEPTION 'invalid_directory_query' USING ERRCODE='22023'; END IF;
 WITH scoped AS MATERIALIZED (
  SELECT d.* FROM public.dealers d WHERE (d.status='VERIFIED' OR wf_canonical_staging.is_approved_source_poster_v2(d.status,d.metadata)) AND (
   nullif(btrim(p_search),'') IS NULL OR strpos(lower(coalesce(d.display_name,'')),lower(btrim(p_search)))>0
   OR strpos(lower(coalesce(d.company_name,'')),lower(btrim(p_search)))>0 OR strpos(lower(coalesce(d.city,'')),lower(btrim(p_search)))>0
   OR (d.contact_consent AND public.normalize_seller_phone_identity(p_search) IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.dealer_source_identities i WHERE i.dealer_id=d.id AND i.verification_status='VERIFIED'
     AND upper(i.identity_type) IN('PHONE','WHATSAPP')
     AND public.normalize_seller_phone_identity(i.source_identity)=public.normalize_seller_phone_identity(p_search))))
 ), filtered AS (SELECT * FROM scoped WHERE NOT p_rated OR review_count>0),page AS MATERIALIZED (
  SELECT * FROM filtered ORDER BY CASE WHEN p_rated THEN rating END DESC NULLS LAST,
   CASE WHEN p_rated THEN review_count END DESC NULLS LAST,lower(coalesce(display_name,company_name,'')),id LIMIT p_limit OFFSET p_offset
 ), page_activity AS MATERIALIZED (
   SELECT d.dealer_id,jsonb_build_object('wts_count',count(*) FILTER(WHERE v.intent='WTS'),'wtb_count',count(*) FILTER(WHERE v.intent='WTB'),
    'listing_total',count(*),'first_post',min(v.source_created_at),'latest_post',max(v.source_created_at),
    'current_counts_are_dynamic',true,'current_counts_scope','CURRENT_TRADING_FLOOR_VISIBLE_LISTINGS') stats
   FROM page selected JOIN wf_canonical_staging.v2_approved_listing_dealers d ON d.dealer_id=selected.id
   JOIN LATERAL (SELECT v.intent,v.source_created_at FROM public.trading_floor_ready_view_v2 v
    WHERE v.listing_id=d.listing_id AND v.source_id=d.source_id AND v.source_hash=d.source_hash OFFSET 0) v ON true
   GROUP BY d.dealer_id
 ), public_page AS (
  SELECT p.*,wf_canonical_staging.dealer_public_source_counts_v3(p.id) source_counts,
   coalesce(activity.stats,jsonb_build_object('wts_count',0,'wtb_count',0,'listing_total',0,'first_post',NULL,'latest_post',NULL,
    'current_counts_are_dynamic',true,'current_counts_scope','CURRENT_TRADING_FLOOR_VISIBLE_LISTINGS')) stats
  FROM page p LEFT JOIN page_activity activity ON activity.dealer_id=p.id
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'all_total',(SELECT count(*) FROM scoped),
  'rated_total',(SELECT count(*) FROM scoped WHERE review_count>0),'publication_revision',(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),
  'dealers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'slug',slug,'display_name',display_name,'company_name',company_name,
   'country_code',country_code,'city',city,'rating',CASE WHEN review_count>0 THEN rating ELSE NULL END,
   'review_count',source_counts->'review_count','whatsapp_group_count',source_counts->'group_count',
   'feedback_captured_at',source_counts->'feedback_captured_at','captured_review_entries',source_counts->'captured_review_entries',
   'avatar_url',avatar_url,'profile_summary',profile_summary,'verified_at',verified_at,'member_since',member_since,
   'source_system',CASE WHEN status='VERIFIED' THEN 'WATCHFACTS_VERIFIED_DEALERS' ELSE 'WATCHFACTS_SOURCE_POSTERS' END,
   'listing_linkage_status','EXACT_PUBLISHED_SOURCE_LINKAGE','stats',stats)
   ORDER BY CASE WHEN p_rated THEN rating END DESC NULLS LAST,CASE WHEN p_rated THEN review_count END DESC NULLS LAST,
    lower(coalesce(display_name,company_name,'')),id) FROM public_page),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
