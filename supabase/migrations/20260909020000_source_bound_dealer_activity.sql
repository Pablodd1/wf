BEGIN;
CREATE INDEX IF NOT EXISTS v2_dealer_activity_lookup
 ON public.seller_listing_lineage_staging(matched_dealer_id,source_record_id)
 WHERE source_system='WF_V2_SOURCE_BOUND' AND match_status='APPLIED';

-- Private bounded profile activity, restricted to currently published singles
-- whose exact source hash still agrees with a verified dealer identity.
CREATE FUNCTION public.get_approved_dealer_profile_v2(
 p_identity text,p_limit integer DEFAULT 50,p_after_id text DEFAULT NULL,
 p_publication_revision bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE profile jsonb; v_dealer_id uuid; revision bigint; activity jsonb; totals jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR (p_after_id IS NOT NULL AND (length(p_after_id) NOT BETWEEN 1 AND 250 OR p_publication_revision IS NULL)) THEN
  RAISE EXCEPTION 'invalid_dealer_activity_page' USING ERRCODE='22023';
 END IF;
 profile=public.get_approved_dealer_profile(p_identity);
 IF profile IS NULL THEN RETURN NULL; END IF;
 v_dealer_id=(profile->'dealer'->>'id')::uuid;
 SELECT r.revision INTO revision FROM wf_canonical_staging.publication_revision r WHERE singleton;
 IF p_publication_revision IS NOT NULL AND p_publication_revision<>revision THEN
  RAISE EXCEPTION 'dealer_activity_publication_changed' USING ERRCODE='22023';
 END IF;
 WITH linked AS MATERIALIZED (
  SELECT DISTINCT v.listing_id,v.intent,v.source_created_at
  FROM wf_canonical_staging.v2_approved_listing_dealers d
  JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 v
   ON v.listing_id=d.listing_id AND v.source_id=d.source_id AND v.source_hash=d.source_hash
  WHERE d.dealer_id=v_dealer_id AND v.is_bundle IS FALSE
   AND v.parent_listing_id IS NULL AND v.child_index IS NULL
 ) SELECT jsonb_build_object('total',count(*),'wts_count',count(*) FILTER(WHERE intent='WTS'),
  'wtb_count',count(*) FILTER(WHERE intent='WTB'),'first_post',min(source_created_at),
  'latest_post',max(source_created_at),'cursor_present',coalesce(bool_or(listing_id=p_after_id),false))
 INTO totals FROM linked;
 IF p_after_id IS NOT NULL AND NOT (totals->>'cursor_present')::boolean THEN
  RAISE EXCEPTION 'invalid_dealer_activity_cursor' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(row.document ORDER BY row.listing_id),'[]'::jsonb) INTO activity FROM (
  SELECT v.listing_id,jsonb_build_object('id',v.listing_id,'brand',v.brand,'model',v.model,
   'reference',v.reference,'dial_color',v.dial_color,'condition',v.condition,'year',v.year,
   'price_usd',v.price_usd,'currency',v.original_price_currency,'price_raw',v.original_price_amount,
   'source_price_text',v.original_price_text,'fx_rate',v.fx_rate,'fx_date',v.fx_date,'fx_source',v.fx_source,
   'listing_type',v.intent,'listing_date',v.source_created_at,'created_at',v.source_created_at,
   'raw_message',v.raw_message_text,'seller_name',v.seller_display_name,
   'image_url',CASE WHEN v.image_status='SOURCE_IMAGE_PRESENT' THEN v.image_url ELSE NULL END) AS document
  FROM wf_canonical_staging.mariadb_canary_published_listings_v2 v
  WHERE v.is_bundle IS FALSE AND v.parent_listing_id IS NULL AND v.child_index IS NULL
   AND (p_after_id IS NULL OR v.listing_id>p_after_id)
   AND EXISTS(SELECT 1 FROM wf_canonical_staging.v2_approved_listing_dealers d
    WHERE d.dealer_id=v_dealer_id AND d.listing_id=v.listing_id AND d.source_id=v.source_id AND d.source_hash=v.source_hash)
  ORDER BY v.listing_id LIMIT p_limit+1
 ) row;
 RETURN profile||jsonb_build_object('listings',activity,'listing_total',(totals->>'total')::bigint,
  'publication_revision',revision,'listing_linkage_status','EXACT_PUBLISHED_SOURCE_LINKAGE',
  'stats',(profile->'stats')||(totals-'total'-'cursor_present')||jsonb_build_object(
   'current_counts_are_dynamic',true,'current_counts_scope','CURRENT_PUBLISHED_SINGLES'));
END;
$$;
REVOKE ALL ON FUNCTION public.get_approved_dealer_profile_v2(text,integer,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_dealer_profile_v2(text,integer,text,bigint) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
