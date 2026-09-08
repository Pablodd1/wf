-- Explicit new admission path; existing singles guards and evidence remain intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.materialize_expanded_candidate_v3(p_candidate_hash text,p_fx_hash text DEFAULT NULL,p_image_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored wf_canonical_staging.expanded_listing_candidates_v3; r wf_canonical_staging.mariadb_raw_source_rows;
 fx wf_canonical_staging.verified_fx_evidence_v2; img wf_canonical_staging.source_image_evidence_v2;
 c jsonb; f jsonb; doc jsonb; v_identity_key jsonb; poster uuid; base_id text; listing text; h text; reasons jsonb;
 amount numeric; currency text; usd numeric; rate numeric; fx_source text; fx_date date; image_key text; image_url text;
 priced boolean=false; child boolean; price_status text; image_status text; posted timestamptz; n integer;
BEGIN
 SELECT * INTO STRICT stored FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=p_candidate_hash;
 c=wf_canonical_staging.verify_expanded_candidate_content_v3(stored.raw_row_id,stored.policy_hash,stored.canonical_json,stored.candidate_hash);
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=stored.raw_row_id;
 f=c->'fields';child=c->>'kind'='CHILD';
 base_id='WF-'||encode(sha256(convert_to(jsonb_build_array(r.source_system,r.source_database,r.source_table,r.source_id)::text,'UTF8')),'hex');
 listing=CASE WHEN child THEN 'WF-C-'||encode(sha256(convert_to(jsonb_build_array(base_id,r.source_hash,stored.child_index)::text,'UTF8')),'hex') ELSE base_id END;
 v_identity_key=jsonb_build_array(r.source_system,r.source_database,
  CASE WHEN public.normalize_seller_phone_identity(r.raw_payload->>'from_number') IS NOT NULL THEN 'PHONE' ELSE 'SOURCE_RECORD' END,
  coalesce(public.normalize_seller_phone_identity(r.raw_payload->>'from_number'),r.source_table||':'||r.source_id));
 INSERT INTO wf_canonical_staging.source_posters_v2(identity_key) VALUES(v_identity_key) ON CONFLICT DO NOTHING;
 SELECT s.poster_id INTO STRICT poster FROM wf_canonical_staging.source_posters_v2 s WHERE s.identity_key=v_identity_key;
 amount=(f->>'original_price_amount')::numeric;currency=f->>'original_price_currency';
 reasons=coalesce(c->'decision'->'price_reasons','[]'::jsonb)||coalesce(c->'decision'->'warnings','[]'::jsonb);
 IF amount>0 AND currency='USD' THEN usd=round(amount,2);rate=1;fx_source='1:1_PARITY_PROOF';fx_date=r.captured_at::date;
 ELSIF amount>0 AND currency NOT IN('USD','USDT','$') AND p_fx_hash IS NOT NULL THEN
  SELECT * INTO STRICT fx FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=p_fx_hash;
  IF fx.document IS DISTINCT FROM fx.canonical_json::jsonb OR encode(sha256(convert_to(fx.canonical_json,'UTF8')),'hex')<>p_fx_hash THEN
   RAISE EXCEPTION 'expanded_fx_content_invalid' USING ERRCODE='22023'; END IF;
  rate=(fx.document->'usd_per_unit'->>currency)::numeric;
  IF rate>0 THEN usd=round(amount*rate,2);fx_source=coalesce(fx.document->>'provider','ECB')||':'||p_fx_hash;fx_date=(fx.document->>'observed_date')::date; END IF;
 END IF;
 priced=coalesce(f->>'intent'='WTS' AND usd BETWEEN 100 AND 500000
  AND c->'decision'->>'price_source'='SOURCE_PRICE_SUPPORTED_REQUIRES_FX_AND_ADMISSION'
  AND coalesce(c->'decision'->'price_reasons','[]'::jsonb)='[]'::jsonb,false);
 price_status=CASE WHEN usd>0 AND currency='USD' THEN 'VERIFIED_USD' WHEN usd>0 THEN 'EXPLICIT_FX_CONVERTED'
  WHEN amount>0 AND currency IS NOT NULL THEN 'FX_RATE_UNAVAILABLE'
  WHEN amount>0 THEN 'UNRESOLVED_CURRENCY'
  WHEN f->>'original_price_text' IS NOT NULL THEN 'SOURCE_PRICE_REQUIRES_REVIEW' ELSE 'PRICE_NOT_SUPPLIED' END;
 IF usd IS NOT NULL AND usd NOT BETWEEN 100 AND 500000 THEN reasons=reasons||'"PRICE_OUTLIER_HELD"'::jsonb; END IF;
 IF child AND p_image_hash IS NOT NULL THEN RAISE EXCEPTION 'expanded_child_image_forbidden' USING ERRCODE='22023'; END IF;
 IF NOT child THEN
  image_key=coalesce(nullif(r.raw_payload->>'front_image',''),r.raw_payload->>'image');
  IF p_image_hash IS NOT NULL THEN
   SELECT * INTO STRICT img FROM wf_canonical_staging.source_image_evidence_v2 WHERE evidence_hash=p_image_hash;
   -- A recorded object observation can be reused only for the exact original key/URL.
   -- It retains its original check date and never claims a fresh network check.
   IF img.document IS DISTINCT FROM img.canonical_json::jsonb OR encode(sha256(convert_to(img.canonical_json,'UTF8')),'hex')<>p_image_hash
    OR img.document->>'image_key' IS DISTINCT FROM image_key
    OR img.document->>'candidate_url' IS DISTINCT FROM wf_canonical_staging.source_image_candidate_v2(image_key)
    OR (img.document->>'disposable')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expanded_original_image_lineage_invalid' USING ERRCODE='22023'; END IF;
   IF img.verified THEN image_url=img.document->>'candidate_url'; END IF;
  END IF;
 END IF;
 image_status=CASE WHEN child OR image_key IS NULL THEN 'NO_IMAGE' WHEN image_url IS NOT NULL THEN 'SOURCE_IMAGE_PRESENT' ELSE 'SOURCE_IMAGE_UNAVAILABLE' END;
 IF r.raw_payload->>'created_on' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN posted=(r.raw_payload->>'created_on')::timestamptz; END IF;
 doc=jsonb_build_object('contract_version','v2.0','listing_id',listing,'parent_listing_id',CASE WHEN child THEN base_id END,
  'child_index',stored.child_index,'source_id',r.source_id,'source_hash',r.source_hash,'raw_message_id',r.id,
  'raw_message_text',CASE WHEN NOT child THEN r.raw_payload->>stored.parent_source_field END,
  'source_context_text',CASE WHEN child THEN c->>'source_context_text' END,
  'source_created_at',posted,'source_created_at_text',r.raw_payload->>'created_on','observed_at',r.captured_at,
  'category','WATCH','brand',f->'brand','model',f->'model','reference',f->'reference','dial_color',f->'dial_color','year',f->'year','condition',f->'condition',
  'intent',f->'intent','intent_status',c->>'intent_evidence_tier','title',NULL,'description',NULL,
  'original_price_text',f->'original_price_text','original_price_amount',amount,'original_price_currency',currency,
  'original_price_role',f->'original_price_role','price_usd',usd,'fx_rate',rate,'fx_source',fx_source,'fx_date',fx_date,
  'price_status',price_status,'price_research_eligible',priced,'included_in_statistics',priced,
  'statistics_exclusion_reason',CASE WHEN f->>'intent'='WTB' THEN 'INTENT_NOT_WTS' WHEN usd IS NULL THEN price_status
   WHEN usd NOT BETWEEN 100 AND 500000 THEN 'PRICE_OUTLIER_HELD' WHEN NOT priced THEN 'SOURCE_PRICE_REQUIRES_REVIEW' END)
 ||jsonb_build_object('image_url',image_url,'thumbnail_url',image_url,'image_key',image_key,
  'image_evidence_type',CASE WHEN child THEN 'NO_IMAGE' WHEN image_url IS NOT NULL THEN 'SOURCE_LINKED_IMAGE' WHEN image_key IS NOT NULL THEN 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED' ELSE 'NO_IMAGE' END,
  'image_status',image_status,'seller_id',poster,'seller_display_name',r.raw_payload->'from_name','seller_profile_url',NULL,
  'seller_review_count',NULL,'seller_listing_count',NULL,'seller_wts_count',NULL,'seller_wtb_count',NULL,'contact_available',false,
  'location_country',f->'country','location_region',coalesce(nullif(btrim(r.raw_payload->>'location'),''),nullif(btrim(r.raw_payload->>'region'),'')),
  'is_bundle',false,'bundle_child_count',NULL,'duplicate_group_id',NULL,
  'review_status',CASE WHEN jsonb_array_length(reasons)>0 THEN 'REVIEW_REQUIRED' ELSE 'REVIEW_NOT_REQUIRED' END,
  'review_reasons',reasons,'test_run_id',CASE WHEN r.raw_payload->'synthetic_fixture'='true'::jsonb THEN 'PIPELINE_V3_SYNTHETIC' END,
  'source_listing_status',r.raw_payload->'status','source_deleted',CASE WHEN r.raw_payload ? 'deleted_on' THEN nullif(r.raw_payload->>'deleted_on','') IS NOT NULL END);
 doc=to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,doc));
 h=encode(sha256(convert_to(jsonb_build_array(p_candidate_hash,doc,p_fx_hash,p_image_hash)::text,'UTF8')),'hex');
 INSERT INTO wf_canonical_staging.expanded_listing_versions_v3(materialization_hash,candidate_hash,listing_id,raw_row_id,source_hash,document,fx_evidence_hash,image_evidence_hash)
 VALUES(h,p_candidate_hash,listing,r.id,r.source_hash,doc,p_fx_hash,p_image_hash) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('materialization_hash',h,'candidate_hash',p_candidate_hash,'listing_id',listing,'inserted',n,'identical',1-n,'outcome','ELIGIBLE');
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.materialize_expanded_candidate_v3(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.verify_expanded_publication_v3(p_listing_id text,p_source_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v wf_canonical_staging.expanded_listing_versions_v3; s wf_canonical_staging.expanded_listing_candidates_v3;
 published jsonb;c jsonb;
BEGIN
 SELECT to_jsonb(p) INTO published FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p
 WHERE p.listing_id=p_listing_id AND p.source_hash=p_source_hash;
 IF published IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO v FROM wf_canonical_staging.expanded_listing_versions_v3 x WHERE x.listing_id=p_listing_id AND x.source_hash=p_source_hash
  AND x.document=published ORDER BY x.materialization_hash LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF encode(sha256(convert_to(jsonb_build_array(v.candidate_hash,v.document,v.fx_evidence_hash,v.image_evidence_hash)::text,'UTF8')),'hex') IS DISTINCT FROM v.materialization_hash THEN RETURN NULL; END IF;
 SELECT * INTO STRICT s FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=v.candidate_hash;
 c=wf_canonical_staging.verify_expanded_candidate_content_v3(s.raw_row_id,s.policy_hash,s.canonical_json,s.candidate_hash);
 IF s.raw_row_id<>v.raw_row_id OR s.source_hash<>v.source_hash OR (c->>'kind'='CHILD' AND
  (published->>'image_url' IS NOT NULL OR published->>'thumbnail_url' IS NOT NULL OR published->>'image_key' IS NOT NULL
   OR published->>'raw_message_text' IS NOT NULL OR published->>'description' IS NOT NULL)) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('outcome','ELIGIBLE','candidate_hash',v.candidate_hash,'materialization_hash',v.materialization_hash,
  'raw_row_id',v.raw_row_id,'source_id',c->>'source_id','source_hash',v.source_hash,'parent_source_field',s.parent_source_field,
  'parent_field_hash',s.parent_field_hash,'parent_listing_id',published->>'parent_listing_id','child_index',published->'child_index',
  'source_context_text',c->>'source_context_text');
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.verify_expanded_publication_v3(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_expanded_listing_source_v3(p_listing_id text,p_source_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb;r wf_canonical_staging.mariadb_raw_source_rows; source_field text;
BEGIN
 IF p_listing_id IS NULL OR length(p_listing_id)>120 OR p_source_hash IS NULL OR p_source_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 proof=wf_canonical_staging.verify_expanded_publication_v3(p_listing_id,p_source_hash);
 IF proof IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=(proof->>'raw_row_id')::uuid;
 source_field=proof->>'parent_source_field';
 RETURN jsonb_build_object('listing_id',p_listing_id,'source_hash',p_source_hash,'raw_message_id',r.id,
  'raw_message_text',r.raw_payload->>source_field,'source_context_text',proof->>'source_context_text',
  'source_listing_status',r.raw_payload->'status','source_deleted',CASE WHEN r.raw_payload ? 'deleted_on' THEN nullif(r.raw_payload->>'deleted_on','') IS NOT NULL END);
END $$;
REVOKE ALL ON FUNCTION public.get_expanded_listing_source_v3(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_expanded_listing_source_v3(text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
