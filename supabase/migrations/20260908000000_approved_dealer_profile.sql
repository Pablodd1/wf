BEGIN;
-- Publish approved profile evidence independently of unresolved listing linkage.
CREATE OR REPLACE FUNCTION public.get_approved_dealer_profile(p_identity text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dealers%ROWTYPE; contact_phone text; result jsonb;
BEGIN
  IF nullif(btrim(p_identity),'') IS NULL OR length(p_identity)>160 THEN
    RAISE EXCEPTION 'invalid_profile_identity' USING ERRCODE='22023';
  END IF;
  SELECT * INTO d FROM public.dealers dealer WHERE dealer.status='VERIFIED'
    AND (dealer.id::text=p_identity OR lower(dealer.slug)=lower(p_identity)) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF d.contact_consent THEN
    SELECT '+' || min(public.normalize_seller_phone_identity(i.source_identity)) INTO contact_phone
    FROM public.dealer_source_identities i WHERE i.dealer_id=d.id
      AND i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
    HAVING count(DISTINCT public.normalize_seller_phone_identity(i.source_identity))=1;
  END IF;
  SELECT jsonb_build_object(
    'dealer',jsonb_build_object('id',d.id,'slug',d.slug,'display_name',d.display_name,
      'company_name',d.company_name,'country_code',d.country_code,'city',d.city,
      'rating',CASE WHEN d.review_count>0 THEN d.rating ELSE NULL END,'review_count',d.review_count,
      'whatsapp_group_count',d.whatsapp_group_count,'avatar_url',d.avatar_url,
      'profile_summary',d.profile_summary,'verified_at',d.verified_at,'member_since',d.member_since,
      'source_system','WATCHFACTS_VERIFIED_DEALERS'),
    'stats',jsonb_build_object('wts_count',NULL,'wtb_count',NULL,'first_post',NULL,'latest_post',NULL,
      'group_count',d.whatsapp_group_count,'current_counts_are_dynamic',false,
      'current_counts_scope','PENDING_EXACT_LISTING_LINKAGE',
      'verified_contact_info',CASE WHEN contact_phone IS NOT NULL THEN jsonb_build_object('phone',contact_phone,'verification_status','VERIFIED') ELSE NULL END),
    'listing_linkage_status','PENDING_EXACT_LISTING_LINKAGE','listing_total',NULL,'listings','[]'::jsonb,
    'reviews',coalesce((SELECT jsonb_agg(r) FROM (
      SELECT review.review_date AS date, review.reviewer_name AS reviewer, review.sentiment, review.rating
      FROM public.dealer_reviews review WHERE review.dealer_id=d.id AND review.source_published
      ORDER BY review.id DESC LIMIT 50
    ) r),'[]'::jsonb),
    'groups',coalesce((SELECT jsonb_agg(g) FROM (
      SELECT membership.group_name AS name,membership.platform,membership.membership_status
      FROM public.dealer_group_memberships membership WHERE membership.dealer_id=d.id AND membership.source_published
      ORDER BY membership.group_name,membership.platform LIMIT 50
    ) g),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_approved_dealer_profile(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_dealer_profile(text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
