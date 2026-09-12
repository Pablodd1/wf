-- A ledger pointer must agree with its content-bound dealer evidence.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_v2_listing_contact(p_listing_id text,p_surface text DEFAULT 'trading-floor') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v wf_canonical_staging.mariadb_canary_published_listings_v2; proof jsonb; d public.dealers;
BEGIN
 IF p_surface NOT IN ('trading-floor','price-research') OR p_surface IS NULL OR p_listing_id IS NULL OR length(p_listing_id)>250 THEN
  RAISE EXCEPTION 'invalid_contact_query' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=p_listing_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.trading_floor_ready_view_v2 WHERE listing_id=p_listing_id)
  OR (p_surface='price-research' AND NOT EXISTS(SELECT 1 FROM public.price_research_ready_view_v2 WHERE listing_id=p_listing_id)) THEN RETURN NULL; END IF;
 proof=wf_canonical_staging.resolve_v2_source_dealer(p_listing_id);
 IF proof->>'dealer_id' IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.seller_listing_lineage_staging l WHERE l.source_system='WF_V2_SOURCE_BOUND'
  AND l.source_record_id=v.listing_id AND l.seller_listing_id=v.source_id AND l.match_status='APPLIED'
  AND l.matched_dealer_id=(proof->>'dealer_id')::uuid AND l.match_evidence=proof-'source_identity' AND l.source_identity=proof->>'source_identity'
 ) THEN RETURN jsonb_build_object('contact_available',false,'reason','SELLER_LINEAGE_UNVERIFIED'); END IF;
 SELECT * INTO d FROM public.dealers WHERE id=(proof->>'dealer_id')::uuid AND status='VERIFIED';
 IF NOT FOUND OR NOT d.contact_consent THEN RETURN jsonb_build_object('contact_available',false,'reason','CONTACT_CONSENT_NOT_GRANTED'); END IF;
 RETURN jsonb_build_object('contact_available',true,'dealer_id',d.id,'dealer_name',d.display_name,
  'dealer_profile_url','/reference-check/'||d.id::text,'dealer_rating',CASE WHEN d.review_count>0 AND d.rating BETWEEN 0 AND 5 THEN d.rating ELSE NULL END,
  'dealer_review_count',d.review_count,'contact_phone',proof->>'source_identity','brand',v.brand,'reference',v.reference);
END;
$$;
REVOKE ALL ON FUNCTION public.get_v2_listing_contact(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_v2_listing_contact(text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
