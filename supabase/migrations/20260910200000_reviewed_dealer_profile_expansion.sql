-- Exact, reviewed source feedback and source-author lineage. No directory entry
-- creates or verifies a dealer; raw records and original poster IDs are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE wf_canonical_staging.reviewed_dealer_captures_v3 (
 snapshot_sha256 text PRIMARY KEY,
 source_text text NOT NULL,
 document jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK (source_text::jsonb=document),
 CHECK (encode(sha256(convert_to(source_text,'UTF8')),'hex')=snapshot_sha256)
);
ALTER TABLE wf_canonical_staging.reviewed_dealer_captures_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_dealer_captures_v3 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE wf_canonical_staging.reviewed_dealer_expansion_batches_v3 (
 batch_key text PRIMARY KEY,manifest_sha256 text NOT NULL,before_sha256 text NOT NULL,after_sha256 text NOT NULL,
 state text NOT NULL CHECK(state IN('APPLIED','ROLLED_BACK')),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.reviewed_dealer_expansion_batches_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_dealer_expansion_batches_v3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.stage_reviewed_dealer_capture_v3(p_text text,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; old wf_canonical_staging.reviewed_dealer_captures_v3; expected_source text; expected_date text; expected_count integer; n integer;
BEGIN
 IF p_sha256='132e51769016dd30380209d7b9fe363e1d59603858126745c5f9c8bae3c3ae7c' THEN
  expected_source='https://watchfacts.com/market-discovery?tab=top-rated';expected_date='2026-08-09';expected_count=25;
 ELSIF p_sha256='4be372700fb9c7730b06722ec28b7d33746e5bf15c752d73b98010da8f71e0b3' THEN
  expected_source='https://watchfacts.com/rated-dealers';expected_date='2026-08-12';expected_count=53;
 ELSE RAISE EXCEPTION 'dealer_capture_not_reviewed' USING ERRCODE='22023'; END IF;
 IF p_text IS NULL OR encode(sha256(convert_to(p_text,'UTF8')),'hex') IS DISTINCT FROM p_sha256 THEN
  RAISE EXCEPTION 'dealer_capture_hash_mismatch' USING ERRCODE='22023'; END IF;
 d=p_text::jsonb;
 IF d->>'source' IS DISTINCT FROM expected_source OR d->>'crawled_at' IS DISTINCT FROM expected_date
  OR jsonb_typeof(d->'profiles') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'profiles')<>expected_count THEN
  RAISE EXCEPTION 'dealer_capture_contract_mismatch' USING ERRCODE='22023'; END IF;
 INSERT INTO wf_canonical_staging.reviewed_dealer_captures_v3 VALUES(p_sha256,p_text,d,now()) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO old FROM wf_canonical_staging.reviewed_dealer_captures_v3 WHERE snapshot_sha256=p_sha256;
 IF old.source_text IS DISTINCT FROM p_text OR old.document IS DISTINCT FROM d THEN
  RAISE EXCEPTION 'dealer_capture_existing_conflict' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('snapshot_sha256',p_sha256,'inserted',n,'profiles',expected_count);
END $$;

CREATE FUNCTION wf_canonical_staging.dealer_source_integer_v3(p_value text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN replace(p_value,',','') ~ '^[0-9]{1,9}$' THEN replace(p_value,',','')::integer ELSE NULL END
$$;

CREATE FUNCTION wf_canonical_staging.apply_reviewed_dealer_capture_v3(p_dealer_id uuid,p_snapshot_sha256 text,p_profile_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE capture wf_canonical_staging.reviewed_dealer_captures_v3; dealer public.dealers; identity public.dealer_source_identities;
 profile jsonb; v_source_system text; v_captured_at timestamptz; profile_phone text; feedback_count integer; feedback jsonb; review_key text;
 evidence jsonb; expected jsonb; actual jsonb; ordinal bigint; added_reviews integer=0; added_snapshots integer=0; n integer; latest jsonb; v_member_since text;
BEGIN
 SELECT * INTO capture FROM wf_canonical_staging.reviewed_dealer_captures_v3 WHERE snapshot_sha256=p_snapshot_sha256;
 IF NOT FOUND THEN RAISE EXCEPTION 'reviewed_dealer_capture_missing' USING ERRCODE='22023'; END IF;
 SELECT x INTO profile FROM jsonb_array_elements(capture.document->'profiles') x
 WHERE coalesce(x->>'id',x->>'profile_id')=p_profile_id;
 IF profile IS NULL OR (SELECT count(*) FROM jsonb_array_elements(capture.document->'profiles') x
  WHERE coalesce(x->>'id',x->>'profile_id')=p_profile_id)<>1 THEN
  RAISE EXCEPTION 'dealer_profile_identity_ambiguous' USING ERRCODE='22023'; END IF;
 SELECT * INTO dealer FROM public.dealers WHERE id=p_dealer_id FOR UPDATE;
 IF NOT FOUND OR NOT (dealer.status='VERIFIED' AND dealer.metadata->>'contract'='WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1'
  OR wf_canonical_staging.is_approved_source_poster_v2(dealer.status,dealer.metadata)) THEN
  RAISE EXCEPTION 'dealer_identity_not_source_reviewed' USING ERRCODE='22023'; END IF;
 IF capture.document->>'crawled_at'='2026-08-09' THEN
  v_source_system='WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT';
  profile_phone=public.normalize_seller_phone_identity(coalesce(profile->>'whatsapp_url',profile->>'chat_url'));
  feedback_count=wf_canonical_staging.dealer_source_integer_v3(profile->>'profile_rating_count');
 ELSE
  v_source_system='WATCHFACTS_PUBLIC_RATED_DEALERS_20260812';
  profile_phone=public.normalize_seller_phone_identity(profile->>'phone');
  feedback_count=wf_canonical_staging.dealer_source_integer_v3(profile->>'review_count');
 END IF;
 SELECT * INTO identity FROM public.dealer_source_identities i WHERE i.dealer_id=dealer.id
  AND i.verification_status='VERIFIED' AND upper(i.identity_type) IN('PHONE','WHATSAPP')
  AND public.normalize_seller_phone_identity(i.source_identity)=profile_phone
  AND i.metadata->>'company_id'=dealer.metadata->>'company_id'
  AND i.metadata->>'company_snapshot_sha256'=dealer.metadata->>'company_snapshot_sha256'
  AND i.metadata->>'contract'=dealer.metadata->>'contract'
  AND i.source_system IN('WF_VERIFIED_SOURCE_COMPANY_V1','WF_SOURCE_POSTER_V1');
 IF NOT FOUND OR profile_phone IS NULL OR (SELECT count(DISTINCT i.dealer_id) FROM public.dealer_source_identities i
   WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN('PHONE','WHATSAPP')
    AND public.normalize_seller_phone_identity(i.source_identity)=profile_phone)<>1
  OR NOT EXISTS(SELECT 1 FROM wf_canonical_staging.source_company_identity_snapshots_v2 s
    WHERE s.snapshot_sha256=identity.metadata->>'company_snapshot_sha256') THEN
  RAISE EXCEPTION 'dealer_profile_exact_identity_not_established' USING ERRCODE='22023'; END IF;
 v_captured_at=((capture.document->>'crawled_at')||'T00:00:00Z')::timestamptz;
 evidence=jsonb_build_object('contract','WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3','source_capture_sha256',p_snapshot_sha256,
  'source_profile_id',p_profile_id,'company_id',dealer.metadata->>'company_id','company_snapshot_sha256',dealer.metadata->>'company_snapshot_sha256',
  'identity_id',identity.id,'source_profile',profile,'captured_feedback_count',jsonb_array_length(coalesce(profile->'reviews','[]')),
  'source_common_group_count',wf_canonical_staging.dealer_source_integer_v3(profile->>'common_groups'),
  'source_profile_feedback_received',wf_canonical_staging.dealer_source_integer_v3(profile->>'feedback_received'),
  'rating_semantics','SOURCE_FEEDBACK_COUNT_NOT_NUMERIC_SCORE','numeric_star_rating_inferred',false,'dealer_verification_inferred',false);
 INSERT INTO public.dealer_directory_snapshots(dealer_id,source_system,source_profile_id,captured_at,source_rank,wts_count,wtb_count,group_count,review_count,positive_feedback_count,negative_feedback_count,evidence)
 VALUES(dealer.id,v_source_system,p_profile_id,v_captured_at,NULL,
  wf_canonical_staging.dealer_source_integer_v3(profile->>'wts'),wf_canonical_staging.dealer_source_integer_v3(profile->>'wtb'),NULL,feedback_count,
  wf_canonical_staging.dealer_source_integer_v3(profile->>'positive_feedback_count'),wf_canonical_staging.dealer_source_integer_v3(profile->>'negative_feedback_count'),evidence)
 ON CONFLICT(source_system,source_profile_id,captured_at) DO NOTHING;
 GET DIAGNOSTICS added_snapshots=ROW_COUNT;
 SELECT to_jsonb(s)-'id'-'imported_at' INTO actual FROM public.dealer_directory_snapshots s
  WHERE s.source_system=v_source_system AND s.source_profile_id=p_profile_id AND s.captured_at=v_captured_at;
 expected=jsonb_build_object('dealer_id',dealer.id,'source_system',v_source_system,'source_profile_id',p_profile_id,'captured_at',v_captured_at,'source_rank',NULL,
  'wts_count',wf_canonical_staging.dealer_source_integer_v3(profile->>'wts'),'wtb_count',wf_canonical_staging.dealer_source_integer_v3(profile->>'wtb'),
  'group_count',NULL,'review_count',feedback_count,'positive_feedback_count',wf_canonical_staging.dealer_source_integer_v3(profile->>'positive_feedback_count'),
  'negative_feedback_count',wf_canonical_staging.dealer_source_integer_v3(profile->>'negative_feedback_count'),'evidence',evidence);
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'dealer_snapshot_preexisting_conflict' USING ERRCODE='22023'; END IF;
 FOR feedback,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(profile->'reviews','[]')) WITH ORDINALITY LOOP
  review_key=encode(sha256(convert_to(jsonb_build_object('snapshot_sha256',p_snapshot_sha256,'profile_id',p_profile_id,'ordinal',ordinal,'review',feedback)::text,'UTF8')),'hex');
  expected=jsonb_build_object('dealer_id',dealer.id,'source_system',v_source_system,'source_review_key',review_key,
   'reviewer_name',feedback->'reviewer','review_date',feedback->'date','sentiment',feedback->'sentiment','rating',NULL,'source_published',true,
   'evidence',jsonb_build_object('contract','WF_REVIEWED_SOURCE_FEEDBACK_V3','source_capture_sha256',p_snapshot_sha256,'source_profile_id',p_profile_id,
    'source_ordinal',ordinal,'source_review',feedback,'numeric_star_rating_inferred',false));
  INSERT INTO public.dealer_reviews(dealer_id,source_system,source_review_key,reviewer_name,review_date,sentiment,rating,source_published,evidence)
  VALUES(dealer.id,v_source_system,review_key,feedback->>'reviewer',feedback->>'date',feedback->>'sentiment',NULL,true,expected->'evidence')
  ON CONFLICT(dealer_id,source_system,source_review_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;added_reviews=added_reviews+n;
  SELECT to_jsonb(r)-'id'-'created_at' INTO actual FROM public.dealer_reviews r
   WHERE r.dealer_id=dealer.id AND r.source_system=v_source_system AND r.source_review_key=review_key;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'dealer_review_preexisting_conflict' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT jsonb_build_object('source_capture_sha256',s.evidence->>'source_capture_sha256','captured_at',s.captured_at,'source_profile_id',s.source_profile_id,'review_count',s.review_count)
 INTO latest FROM public.dealer_directory_snapshots s WHERE s.dealer_id=dealer.id AND s.evidence->>'contract'='WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3'
  AND s.review_count IS NOT NULL ORDER BY s.captured_at DESC,s.source_system,s.source_profile_id LIMIT 1;
 SELECT s.evidence->'source_profile'->>'member_since' INTO v_member_since FROM public.dealer_directory_snapshots s
  WHERE s.dealer_id=dealer.id AND nullif(s.evidence->'source_profile'->>'member_since','') IS NOT NULL
   AND s.evidence->>'contract'='WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3' ORDER BY s.captured_at DESC LIMIT 1;
 UPDATE public.dealers d SET review_count=coalesce((latest->>'review_count')::integer,d.review_count),
  member_since=coalesce(v_member_since,d.member_since),metadata=d.metadata||jsonb_build_object('reviewed_profile_evidence_v3',latest),last_synced_at=now()
 WHERE d.id=dealer.id AND (d.review_count IS DISTINCT FROM coalesce((latest->>'review_count')::integer,d.review_count)
  OR d.member_since IS DISTINCT FROM coalesce(v_member_since,d.member_since) OR d.metadata->'reviewed_profile_evidence_v3' IS DISTINCT FROM latest);
 RETURN jsonb_build_object('dealer_id',dealer.id,'source_profile_id',p_profile_id,'inserted_snapshots',added_snapshots,'inserted_reviews',added_reviews,'rating_inferred',false,'verification_changed',false);
END $$;

DO $copy$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.resolve_v2_source_dealer(text)'::regprocedure);
 IF strpos(definition,'resolve_v2_source_dealer(')=0 THEN RAISE EXCEPTION 'dealer_resolver_base_missing'; END IF;
 EXECUTE replace(definition,'resolve_v2_source_dealer(','resolve_v2_source_dealer_pre_expansion_v3(');
END $copy$;

CREATE OR REPLACE FUNCTION wf_canonical_staging.resolve_v2_source_dealer(p_listing_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE listing wf_canonical_staging.mariadb_canary_published_listings_v2; raw wf_canonical_staging.mariadb_raw_source_rows;
 proof jsonb; result jsonb; phone text; dealer_id uuid; identity_id bigint;
BEGIN
 SELECT * INTO listing FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=p_listing_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 proof=wf_canonical_staging.verify_expanded_publication_v3(p_listing_id,listing.source_hash);
 IF proof IS NULL THEN RETURN wf_canonical_staging.resolve_v2_source_dealer_pre_expansion_v3(p_listing_id); END IF;
 result=jsonb_build_object('contract','V2_SOURCE_BOUND','listing_id',listing.listing_id,'source_id',listing.source_id,'source_hash',listing.source_hash,
  'candidate_hash',proof->>'candidate_hash','materialization_hash',proof->>'materialization_hash','parent_listing_id',proof->'parent_listing_id','child_index',proof->'child_index');
 SELECT * INTO raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=(proof->>'raw_row_id')::uuid;
 IF NOT FOUND OR proof->>'outcome' IS DISTINCT FROM 'ELIGIBLE' OR raw.source_id IS DISTINCT FROM listing.source_id
  OR raw.source_hash IS DISTINCT FROM listing.source_hash OR listing.raw_message_id IS DISTINCT FROM raw.id::text
  OR encode(sha256(convert_to(raw.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM raw.source_hash
  OR raw.raw_payload_text::jsonb IS DISTINCT FROM raw.raw_payload THEN
  RETURN result||jsonb_build_object('reason','SOURCE_CONTENT_UNVERIFIED'); END IF;
 result=result||jsonb_build_object('raw_row_id',raw.id);
 phone=public.normalize_seller_phone_identity(raw.raw_payload->>'from_number');
 IF phone IS NULL THEN RETURN result||jsonb_build_object('reason','MISSING_SOURCE_CONTACT'); END IF;
 SELECT i.dealer_id,i.id INTO dealer_id,identity_id FROM public.dealer_source_identities i
 JOIN public.dealers d ON d.id=i.dealer_id AND (d.status='VERIFIED' OR wf_canonical_staging.is_approved_source_poster_v2(d.status,d.metadata))
 WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN('PHONE','WHATSAPP')
  AND public.normalize_seller_phone_identity(i.source_identity)=phone
  AND i.source_system IN('WF_VERIFIED_SOURCE_COMPANY_V1','WF_SOURCE_POSTER_V1')
  AND i.metadata->>'contract' IN('WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1','WF_COMPLETE_SOURCE_POSTER_IDENTITY_V1')
  AND d.metadata->>'contract'=i.metadata->>'contract' AND d.metadata->>'company_id'=i.metadata->>'company_id'
  AND d.metadata->>'company_snapshot_sha256'=i.metadata->>'company_snapshot_sha256'
  AND i.metadata->>'company_id'=raw.raw_payload->>'company_id'
  AND i.metadata->>'source_system'=raw.source_system AND i.metadata->>'source_database'=raw.source_database AND i.metadata->>'source_table'=raw.source_table
  AND EXISTS(SELECT 1 FROM wf_canonical_staging.source_company_identity_snapshots_v2 s WHERE s.snapshot_sha256=i.metadata->>'company_snapshot_sha256');
 IF NOT FOUND OR (SELECT count(DISTINCT i.dealer_id) FROM public.dealer_source_identities i
   WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN('PHONE','WHATSAPP')
    AND public.normalize_seller_phone_identity(i.source_identity)=phone)<>1 THEN
  RETURN result||jsonb_build_object('reason','VERIFIED_DEALER_NOT_FOUND'); END IF;
 RETURN result||jsonb_build_object('reason','EXACT_VERIFIED_PHONE','dealer_id',dealer_id,'identity_id',identity_id,'source_identity',phone);
END $$;

-- A default zero in an imported dealer row is not evidence of zero feedback.
-- These values are derived from a reviewed, dated source observation only.
CREATE FUNCTION wf_canonical_staging.dealer_public_source_counts_v3(p_dealer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('review_count',(SELECT s.review_count FROM public.dealer_directory_snapshots s
   WHERE s.dealer_id=p_dealer_id AND s.evidence->>'contract'='WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3' AND s.review_count IS NOT NULL
   ORDER BY s.captured_at DESC,s.source_system,s.source_profile_id LIMIT 1),
  'feedback_captured_at',(SELECT s.captured_at FROM public.dealer_directory_snapshots s
   WHERE s.dealer_id=p_dealer_id AND s.evidence->>'contract'='WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3' AND s.review_count IS NOT NULL
   ORDER BY s.captured_at DESC,s.source_system,s.source_profile_id LIMIT 1),
  'captured_review_entries',(SELECT count(*) FROM public.dealer_reviews r WHERE r.dealer_id=p_dealer_id AND r.source_published),
  'group_count',(SELECT s.group_count FROM public.dealer_directory_snapshots s WHERE s.dealer_id=p_dealer_id
   AND s.evidence->>'contract'='WF_REVIEWED_DEALER_PROFILE_CAPTURE_V3' AND s.group_count IS NOT NULL
   ORDER BY s.captured_at DESC,s.source_system,s.source_profile_id LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION public.get_approved_dealer_profile_v2(
 p_identity text,p_limit integer DEFAULT 50,p_after_id text DEFAULT NULL,p_publication_revision bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE profile jsonb;v_dealer_id uuid;revision bigint;activity jsonb;totals jsonb;source_counts jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR (p_after_id IS NOT NULL AND (length(p_after_id) NOT BETWEEN 1 AND 250 OR p_publication_revision IS NULL)) THEN
  RAISE EXCEPTION 'invalid_dealer_activity_page' USING ERRCODE='22023'; END IF;
 profile=public.get_approved_dealer_profile(p_identity);
 IF profile IS NULL THEN RETURN NULL; END IF;
 v_dealer_id=(profile->'dealer'->>'id')::uuid;
 SELECT r.revision INTO revision FROM wf_canonical_staging.publication_revision r WHERE singleton;
 IF p_publication_revision IS NOT NULL AND p_publication_revision<>revision THEN
  RAISE EXCEPTION 'dealer_activity_publication_changed' USING ERRCODE='22023'; END IF;
 WITH linked AS MATERIALIZED (
  SELECT DISTINCT v.listing_id,v.intent,v.source_created_at FROM wf_canonical_staging.v2_approved_listing_dealers d
  JOIN public.trading_floor_ready_view_v2 v ON v.listing_id=d.listing_id AND v.source_id=d.source_id AND v.source_hash=d.source_hash
  WHERE d.dealer_id=v_dealer_id
 ) SELECT jsonb_build_object('total',count(*),'wts_count',count(*) FILTER(WHERE intent='WTS'),
  'wtb_count',count(*) FILTER(WHERE intent='WTB'),'first_post',min(source_created_at),'latest_post',max(source_created_at),
  'cursor_present',coalesce(bool_or(listing_id=p_after_id),false)) INTO totals FROM linked;
 IF p_after_id IS NOT NULL AND NOT (totals->>'cursor_present')::boolean THEN
  RAISE EXCEPTION 'invalid_dealer_activity_cursor' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row.document ORDER BY row.listing_id),'[]'::jsonb) INTO activity FROM (
  SELECT v.listing_id,jsonb_build_object('id',v.listing_id,'brand',v.brand,'model',v.model,'reference',v.reference,
   'dial_color',v.dial_color,'condition',v.condition,'year',v.year,'price_usd',v.price_usd,
   'currency',v.original_price_currency,'price_raw',v.original_price_amount,'source_price_text',v.original_price_text,
   'original_price_role',v.original_price_role,'fx_rate',v.fx_rate,'fx_date',v.fx_date,'fx_source',v.fx_source,
   'listing_type',v.intent,'listing_date',v.source_created_at,'created_at',v.source_created_at,
   'source_created_at_text',v.source_created_at_text,'source_listing_status',v.source_listing_status,
   'raw_message',coalesce(v.source_context_text,v.raw_message_text),'seller_name',v.seller_display_name,
   'parent_listing_id',v.parent_listing_id,'child_index',v.child_index,'source_id',v.source_id,'source_hash',v.source_hash,
   'image_url',CASE WHEN v.image_status='SOURCE_IMAGE_PRESENT' THEN v.image_url ELSE NULL END) document
  FROM public.trading_floor_ready_view_v2 v WHERE (p_after_id IS NULL OR v.listing_id>p_after_id)
   AND EXISTS(SELECT 1 FROM wf_canonical_staging.v2_approved_listing_dealers d WHERE d.dealer_id=v_dealer_id
    AND d.listing_id=v.listing_id AND d.source_id=v.source_id AND d.source_hash=v.source_hash)
  ORDER BY v.listing_id LIMIT p_limit+1
 ) row;
 source_counts=wf_canonical_staging.dealer_public_source_counts_v3(v_dealer_id);
 RETURN profile||jsonb_build_object('dealer',(profile->'dealer')||jsonb_build_object('review_count',source_counts->'review_count',
   'whatsapp_group_count',source_counts->'group_count','feedback_captured_at',source_counts->'feedback_captured_at',
   'captured_review_entries',source_counts->'captured_review_entries'),
  'listings',activity,'listing_total',(totals->>'total')::bigint,'publication_revision',revision,
  'listing_linkage_status','EXACT_PUBLISHED_SOURCE_LINKAGE','stats',(profile->'stats')||(totals-'total'-'cursor_present')||
   jsonb_build_object('group_count',source_counts->'group_count','current_counts_are_dynamic',true,
    'current_counts_scope','CURRENT_TRADING_FLOOR_VISIBLE_LISTINGS'));
END $$;

CREATE OR REPLACE FUNCTION public.get_approved_dealer_directory(
 p_search text DEFAULT NULL,p_rated boolean DEFAULT false,p_limit integer DEFAULT 24,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 ), public_page AS (
  SELECT p.*,wf_canonical_staging.dealer_public_source_counts_v3(p.id) source_counts,activity.stats
  FROM page p CROSS JOIN LATERAL (
   SELECT jsonb_build_object('wts_count',count(*) FILTER(WHERE v.intent='WTS'),'wtb_count',count(*) FILTER(WHERE v.intent='WTB'),
    'listing_total',count(*),'first_post',min(v.source_created_at),'latest_post',max(v.source_created_at),
    'current_counts_are_dynamic',true,'current_counts_scope','CURRENT_TRADING_FLOOR_VISIBLE_LISTINGS') stats
   FROM wf_canonical_staging.v2_approved_listing_dealers d JOIN public.trading_floor_ready_view_v2 v
    ON v.listing_id=d.listing_id AND v.source_id=d.source_id AND v.source_hash=d.source_hash WHERE d.dealer_id=p.id
  ) activity
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
END $$;

DO $counts$
DECLARE definition text;needle text;
BEGIN
 definition=pg_get_viewdef('wf_canonical_staging.v2_approved_listing_dealers'::regclass,true);
 needle='d.review_count';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'dealer_count_view_definition_changed'; END IF;
 EXECUTE 'CREATE OR REPLACE VIEW wf_canonical_staging.v2_approved_listing_dealers WITH(security_invoker=true) AS '||
  replace(definition,needle,'CASE WHEN (d.metadata->''reviewed_profile_evidence_v3''->>''review_count'') ~ ''^[0-9]{1,9}$'' THEN d.review_count ELSE NULL END AS review_count');
END $counts$;

REVOKE ALL ON FUNCTION wf_canonical_staging.dealer_public_source_counts_v3(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_approved_dealer_profile_v2(text,integer,text,bigint),public.get_approved_dealer_directory(text,boolean,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_dealer_profile_v2(text,integer,text,bigint),public.get_approved_dealer_directory(text,boolean,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION wf_canonical_staging.stage_reviewed_dealer_capture_v3(text,text),
 wf_canonical_staging.dealer_source_integer_v3(text),
 wf_canonical_staging.apply_reviewed_dealer_capture_v3(uuid,text,text),
 wf_canonical_staging.resolve_v2_source_dealer_pre_expansion_v3(text),
 wf_canonical_staging.resolve_v2_source_dealer(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION wf_canonical_staging.stage_reviewed_dealer_capture_v3(text,text),
 wf_canonical_staging.apply_reviewed_dealer_capture_v3(uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
