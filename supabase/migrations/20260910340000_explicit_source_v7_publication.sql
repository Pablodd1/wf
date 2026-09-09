-- Extend the exact reviewed seven-policy publication gate. No raw/public listing DML.
BEGIN;
SET LOCAL lock_timeout='5s';
-- V7 only: exact original source spans remain authoritative. This derived view
-- removes keycap marks solely for validating an already reviewed literal price.
CREATE FUNCTION wf_canonical_staging.expanded_parsing_view_v7(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT translate(wf_canonical_staging.expanded_parsing_view_v3(p_text),U&'\fe0f\20e3','');
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.expanded_parsing_view_v7(text) FROM PUBLIC,anon,authenticated,service_role;

-- Called only after full candidate/hash/admission validation. Recheck the own
-- marker against immutable raw, its containing offer, and explicit current status.
CREATE FUNCTION wf_canonical_staging.expanded_source_status_v7(c jsonb,raw jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE value text=c->'fields'->>'source_status';s jsonb;t text;offer jsonb;
 a integer;b integer;prefix text;suffix text;n integer;
BEGIN
 IF value IS NOT DISTINCT FROM raw->>'status' THEN RETURN value;END IF;
 IF c->>'parser_version' IS DISTINCT FROM 'expanded-evidence-v7-explicit-source-repair'
  OR lower(coalesce(raw->>'status','')) NOT IN('open','active','available')
  OR value IS NULL OR value NOT IN('hold','sold','reserved')
  OR jsonb_typeof(c->'evidence'->'source_status') IS DISTINCT FROM 'array'
  OR jsonb_array_length(c->'evidence'->'source_status')<>1 THEN
  RAISE EXCEPTION 'expanded_own_source_status_not_proved' USING ERRCODE='22023';END IF;
 s=c->'evidence'->'source_status'->0;t=raw->>(c->>'parent_source_field');
 IF s->>'role' IS DISTINCT FROM 'EXPLICIT_OWN_OFFER_AVAILABILITY'
  OR s->>'field' IS DISTINCT FROM c->>'parent_source_field'
  OR s->>'offset_unit' IS DISTINCT FROM 'UNICODE_CODEPOINT' OR s->'end_exclusive' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(s->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'end') IS DISTINCT FROM 'number'
  OR s->>'start' !~ '^[0-9]+$' OR s->>'end' !~ '^[0-9]+$' THEN
  RAISE EXCEPTION 'expanded_own_source_status_span_invalid' USING ERRCODE='22023';END IF;
 a=(s->>'start')::integer;b=(s->>'end')::integer;
 IF t IS NULL OR a<0 OR b<=a OR b>char_length(t)
  OR encode(sha256(convert_to(t,'UTF8')),'hex') IS DISTINCT FROM s->>'field_sha256'
  OR substring(t FROM a+1 FOR b-a) IS DISTINCT FROM s->>'quote'
  OR encode(sha256(convert_to(s->>'quote','UTF8')),'hex') IS DISTINCT FROM s->>'quote_sha256'
  OR lower(wf_canonical_staging.expanded_parsing_view_v7(s->>'quote')) IS DISTINCT FROM value THEN
  RAISE EXCEPTION 'expanded_own_source_status_span_invalid' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(c->'source_spans') x
 WHERE x->>'field'=s->>'field' AND (x->>'start')::integer<=a AND (x->>'end')::integer>=b;
 IF n<>1 THEN RAISE EXCEPTION 'expanded_own_source_status_outside_offer' USING ERRCODE='22023';END IF;
 SELECT x INTO STRICT offer FROM jsonb_array_elements(c->'source_spans') x
 WHERE x->>'field'=s->>'field' AND (x->>'start')::integer<=a AND (x->>'end')::integer>=b;
 prefix=wf_canonical_staging.expanded_parsing_view_v7(substring(t FROM (offer->>'start')::integer+1 FOR a-(offer->>'start')::integer));
 suffix=wf_canonical_staging.expanded_parsing_view_v7(substring(t FROM b+1 FOR (offer->>'end')::integer-b));
 prefix=regexp_replace(prefix,U&'^.*[\000d\000a\2028\2029]','');
 suffix=regexp_replace(suffix,U&'[\000d\000a\2028\2029].*$','');
 IF prefix ~* '\m(not|never|no|unsold|can|cannot|will|previously|formerly|was)\M'
  OR suffix !~ '^[[:space:]*)\]!.:;-]*$'
  OR NOT(prefix ~ '^[[:space:]]*$' OR prefix ~ '[([][[:space:]]*$' OR prefix ~* '\m(on|now)[[:space:]]+$')
  OR (value='sold' AND c->'fields'->>'intent'='WTB') THEN
  RAISE EXCEPTION 'expanded_own_source_status_context_requires_review' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.expanded_source_status_v7(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION wf_canonical_staging.verify_expanded_candidate_content_v3(p_raw_id uuid,p_policy_hash text,p_canonical text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r wf_canonical_staging.mariadb_raw_source_rows; pol wf_canonical_staging.expanded_publication_policies_v3;
 c jsonb; f jsonb; e jsonb; source text; span jsonb; field_name text; evidence_group jsonb; n integer; a integer; b integer;
 raw_number text; number_token text; scale_token text; computed_amount numeric; price_view text;
BEGIN
 IF p_canonical IS NULL OR octet_length(p_canonical)>1000000 OR p_hash IS NULL
  OR encode(sha256(convert_to(p_canonical,'UTF8')),'hex') IS DISTINCT FROM p_hash THEN
  RAISE EXCEPTION 'expanded_candidate_hash_invalid' USING ERRCODE='22023'; END IF;
 c=p_canonical::jsonb;f=c->'fields';e=c->'evidence';
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 SELECT * INTO STRICT pol FROM wf_canonical_staging.expanded_publication_policies_v3 WHERE policy_hash=p_policy_hash;
 IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_candidate_admissions_v3 a WHERE a.candidate_hash=p_hash
  AND a.policy_hash=p_policy_hash AND a.source_hash=r.source_hash AND a.review_manifest_sha256=pol.review_manifest_sha256) THEN
  RAISE EXCEPTION 'expanded_candidate_not_in_reviewed_manifest' USING ERRCODE='22023'; END IF;
 IF r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence'
  OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM r.source_hash
  OR (c->>'source_system',c->>'source_database',c->>'source_table',c->>'source_id',c->>'source_hash')
   IS DISTINCT FROM (r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash)
  OR c->>'contract' IS DISTINCT FROM 'WF_EXPANDED_SOURCE_CANDIDATE_V1'
  OR c->>'parser_version' IS DISTINCT FROM pol.parser_version OR c->'dependency_hashes' IS DISTINCT FROM pol.dependency_hashes
  OR c->'decision'->>'trading_floor' IS DISTINCT FROM 'TF_SUPPORTED_CANDIDATE'
  OR c->'decision'->'reasons' IS DISTINCT FROM '[]'::jsonb
  OR f->>'category' IS DISTINCT FROM 'WATCH' OR f->>'intent' IS NULL OR f->>'intent' NOT IN('WTS','WTB')
  OR nullif(btrim(f->>'brand'),'') IS NULL OR nullif(btrim(f->>'reference'),'') IS NULL
  OR c->>'kind' IS NULL OR c->>'kind' NOT IN('SINGLE','CHILD') THEN
  RAISE EXCEPTION 'expanded_candidate_source_or_policy_invalid' USING ERRCODE='22023'; END IF;
 field_name=c->>'parent_source_field';source=r.raw_payload->>field_name;
 IF field_name NOT IN('title','description','comments') OR source IS NULL OR btrim(source)=''
  OR encode(sha256(convert_to(source,'UTF8')),'hex') IS DISTINCT FROM c->>'parent_field_hash'
  OR jsonb_typeof(c->'source_spans') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'source_spans')<1
  OR jsonb_typeof(c->'context_spans') IS DISTINCT FROM 'array' OR jsonb_typeof(e) IS DISTINCT FROM 'object'
  OR c->'source_spans'->0->>'quote' IS DISTINCT FROM c->>'source_context_text' THEN
  RAISE EXCEPTION 'expanded_parent_field_or_child_span_invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(c->'source_spans')>1 AND (c->>'kind' IS DISTINCT FROM 'CHILD'
  OR c->>'repeated_block_policy' IS DISTINCT FROM 'IDENTICAL_SOURCE_BLOCK_NOT_ADDITIONAL_UNIT') THEN
  RAISE EXCEPTION 'expanded_repeated_block_policy_invalid' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'source_spans') s
  WHERE s->>'role' IS DISTINCT FROM 'OFFER_BLOCK' OR NOT(s ? 'start') OR s->>'quote' IS DISTINCT FROM c->>'source_context_text') THEN
  RAISE EXCEPTION 'expanded_offer_block_not_exact' USING ERRCODE='22023'; END IF;
 IF (c->>'kind'='SINGLE' AND c->>'child_index' IS NOT NULL)
  OR (c->>'kind'='CHILD' AND (coalesce((c->>'child_index')::integer,0)<1 OR c->'images' IS DISTINCT FROM
   '{"image_key":null,"image_url":null,"primary_image_key":null,"primary_image_url":null,"thumbnail":null,"thumbnail_url":null,"image_urls":[],"images":[],"gallery":[]}'::jsonb)) THEN
  RAISE EXCEPTION 'expanded_child_image_or_identity_invalid' USING ERRCODE='22023'; END IF;
 -- PostgreSQL substring counts Unicode codepoints, matching the frozen proof.
 FOR span IN SELECT value FROM jsonb_array_elements(c->'source_spans')
  UNION ALL SELECT value FROM jsonb_array_elements(c->'context_spans')
 UNION ALL SELECT v.value FROM jsonb_each(e) g CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g.value)='array' THEN g.value ELSE '[]'::jsonb END) v LOOP
  IF jsonb_typeof(span) IS DISTINCT FROM 'object' OR nullif(span->>'field','') IS NULL OR nullif(span->>'role','') IS NULL THEN
   RAISE EXCEPTION 'expanded_evidence_shape_invalid' USING ERRCODE='22023'; END IF;
  IF span ? 'start' THEN
   a=(span->>'start')::integer;b=(span->>'end')::integer;
   IF span->>'field' IS DISTINCT FROM field_name OR span->>'field_sha256' IS DISTINCT FROM c->>'parent_field_hash'
    OR span->>'offset_unit' IS DISTINCT FROM 'UNICODE_CODEPOINT' OR span->'end_exclusive' IS DISTINCT FROM 'true'::jsonb
    OR a IS NULL OR b IS NULL OR a<0 OR b<=a OR b>char_length(source)
    OR substring(source FROM a+1 FOR b-a) IS DISTINCT FROM span->>'quote'
    OR encode(sha256(convert_to(span->>'quote','UTF8')),'hex') IS DISTINCT FROM span->>'quote_sha256' THEN
    RAISE EXCEPTION 'expanded_evidence_span_invalid' USING ERRCODE='22023'; END IF;
  ELSE
   IF span->>'field' NOT IN('brand','type','country') OR NOT(span ? 'value') OR span->'value'='null'::jsonb OR NOT(r.raw_payload ? (span->>'field'))
    OR span->'value' IS DISTINCT FROM r.raw_payload->(span->>'field')
    OR encode(sha256(convert_to((span->'value')::text,'UTF8')),'hex') IS DISTINCT FROM span->>'value_sha256'
    OR span->>'role' NOT IN('SOURCE_METADATA_CATALOG_CORROBORATED','NONCONFLICTING_SOURCE_TYPE','EXPLICIT_SOURCE_METADATA') THEN
    RAISE EXCEPTION 'expanded_metadata_evidence_invalid' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 IF coalesce(jsonb_array_length(e->'reference'),0)<>1 OR coalesce(jsonb_array_length(e->'brand'),0)<1
  OR coalesce(jsonb_array_length(e->'intent'),0)<1 THEN
  RAISE EXCEPTION 'expanded_required_field_proof_missing' USING ERRCODE='22023'; END IF;
 IF upper(regexp_replace(normalize(e->'reference'->0->>'quote',NFKC),'[^a-zA-Z0-9]','','g'))
  IS DISTINCT FROM upper(regexp_replace(f->>'reference','[^a-zA-Z0-9]','','g')) THEN
  RAISE EXCEPTION 'expanded_reference_not_source_exact' USING ERRCODE='22023'; END IF;
 IF c->>'intent_evidence_tier'='NONCONFLICTING_SOURCE_TYPE' AND f->>'intent' IS DISTINCT FROM
  (CASE lower(r.raw_payload->>'type') WHEN 'sale' THEN 'WTS' WHEN 'search' THEN 'WTB' END) THEN
  RAISE EXCEPTION 'expanded_source_type_intent_invalid' USING ERRCODE='22023'; END IF;
 IF c->>'intent_evidence_tier' IS NULL OR c->>'intent_evidence_tier' NOT IN('EXPLICIT_MESSAGE','EXPLICIT_SECTION','NONCONFLICTING_SOURCE_TYPE','CLEAR_ASKING_PRICE_INFERENCE') THEN
  RAISE EXCEPTION 'expanded_intent_tier_invalid' USING ERRCODE='22023'; END IF;
 IF f->>'original_price_amount' IS NOT NULL AND (coalesce(jsonb_array_length(e->'price'),0)<1
  OR f->>'original_price_amount' !~ '^[0-9]+([.][0-9]+)?$' OR (f->>'original_price_amount')::numeric<=0
  OR f->>'original_price_currency' IN('$','[NULL]')) THEN
  RAISE EXCEPTION 'expanded_original_price_evidence_invalid' USING ERRCODE='22023'; END IF;
 IF f->>'original_price_amount' IS NOT NULL THEN
  price_view=CASE WHEN c->>'parser_version'='expanded-evidence-v7-explicit-source-repair'
   THEN wf_canonical_staging.expanded_parsing_view_v7(e->'price'->0->>'quote')
   ELSE wf_canonical_staging.expanded_parsing_view_v3(e->'price'->0->>'quote') END;
  raw_number=(regexp_match(price_view,'[0-9][0-9.,]*'))[1];
  IF c->>'parser_version'='expanded-evidence-v7-explicit-source-repair' THEN
   scale_token=(regexp_match(price_view,'(?:^|[0-9.,[:space:]])(million|mill|mil|mn|m|k)(?=$|[^a-z]|(?:usd|usdt|hkd|eur|gbp|chf|sgd|jpy|cny|rmb|aud|cad|nzd|inr|thb|myr|krw|twd|sar|qar|kwd|bhd|zar|brl|mxn|php|idr|vnd|try|dkk|nok|sek)\M)','i'))[1];
  ELSE
  scale_token=(regexp_match(price_view,'(?:^|[0-9.,[:space:]])(million|mill|mil|mn|m|k)(?:$|[^a-z])','i'))[1];
  END IF;
  IF e->'price_numeric'->>'decimal_rule' IS DISTINCT FROM 'EXACT_SOURCE_DECIMAL_AND_EXPLICIT_SCALE_NO_ROUNDING'
   OR e->'price_numeric'->>'raw_number' IS DISTINCT FROM raw_number
   OR e->'price_numeric'->>'scale_token' IS DISTINCT FROM lower(scale_token) THEN
   RAISE EXCEPTION 'expanded_price_decimal_proof_invalid' USING ERRCODE='22023'; END IF;
  number_token=raw_number;
  IF number_token ~ '^[0-9]{1,3}(,[0-9]{3})+([.][0-9]{1,2})?$' AND scale_token IS NULL THEN number_token=replace(number_token,',','');
  ELSIF number_token ~ '^[0-9]{1,3}([.][0-9]{3})+$' AND scale_token IS NULL THEN number_token=replace(number_token,'.','');
  ELSIF number_token ~ '^[0-9]+[.,][0-9]+$' THEN number_token=replace(number_token,',','.'); END IF;
  IF number_token IS NULL OR number_token !~ '^[0-9]+([.][0-9]+)?$' THEN RAISE EXCEPTION 'expanded_price_decimal_format_invalid' USING ERRCODE='22023'; END IF;
  computed_amount=number_token::numeric*CASE WHEN scale_token IS NULL THEN 1 WHEN lower(scale_token)='k' THEN 1000 ELSE 1000000 END;
  IF computed_amount IS DISTINCT FROM (f->>'original_price_amount')::numeric
   OR computed_amount IS DISTINCT FROM (e->'price_numeric'->>'amount')::numeric THEN
   RAISE EXCEPTION 'expanded_price_amount_not_source_exact' USING ERRCODE='22023'; END IF;
 END IF;
 FOREACH field_name IN ARRAY ARRAY['condition','year','dial_color','model','country'] LOOP
  IF f->>field_name IS NOT NULL AND coalesce(jsonb_array_length(e->field_name),0)<1 THEN
   RAISE EXCEPTION 'expanded_optional_field_without_evidence' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM wf_canonical_staging.expanded_source_status_v7(c,r.raw_payload);
 IF c->'source_dates' IS DISTINCT FROM jsonb_build_object('created_on',r.raw_payload->'created_on','updated_on',r.raw_payload->'updated_on',
   'reposted_at',r.raw_payload->'reposted_at','deleted_on',r.raw_payload->'deleted_on') THEN
  RAISE EXCEPTION 'expanded_source_status_or_dates_changed' USING ERRCODE='22023'; END IF;
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION wf_canonical_staging.materialize_expanded_candidate_v3(p_candidate_hash text,p_fx_hash text DEFAULT NULL,p_image_hash text DEFAULT NULL)
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
  'source_listing_status',f->'source_status','source_deleted',CASE WHEN r.raw_payload ? 'deleted_on' THEN nullif(r.raw_payload->>'deleted_on','') IS NOT NULL END);
 doc=to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,doc));
 h=encode(sha256(convert_to(jsonb_build_array(p_candidate_hash,doc,p_fx_hash,p_image_hash)::text,'UTF8')),'hex');
 INSERT INTO wf_canonical_staging.expanded_listing_versions_v3(materialization_hash,candidate_hash,listing_id,raw_row_id,source_hash,document,fx_evidence_hash,image_evidence_hash)
 VALUES(h,p_candidate_hash,listing,r.id,r.source_hash,doc,p_fx_hash,p_image_hash) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('materialization_hash',h,'candidate_hash',p_candidate_hash,'listing_id',listing,'inserted',n,'identical',1-n,'outcome','ELIGIBLE');
END $$;

CREATE OR REPLACE FUNCTION wf_canonical_staging.propose_existing_enrichment_before_identity270_v3(p_listing text,p_raw uuid,p_source_hash text,p_before_hash text,p_candidate text DEFAULT NULL,p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_doc jsonb; r wf_canonical_staging.mariadb_raw_source_rows;
 c wf_canonical_staging.expanded_listing_candidates_v3; v wf_canonical_staging.expanded_listing_versions_v3;
 candidate jsonb;f jsonb;values_doc jsonb='{}';patch jsonb='{}';conflicts jsonb='[]';k text;has_usd boolean;price_conflict boolean;
BEGIN
 SELECT to_jsonb(x) INTO STRICT current_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE listing_id=p_listing;
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw;
 IF encode(sha256(convert_to(current_doc::text,'UTF8')),'hex') IS DISTINCT FROM p_before_hash
  OR current_doc->>'source_id' IS DISTINCT FROM r.source_id OR current_doc->>'source_hash' IS DISTINCT FROM r.source_hash
  OR r.source_hash IS DISTINCT FROM p_source_hash OR current_doc->>'raw_message_id' IS DISTINCT FROM p_raw::text
  OR current_doc->>'parent_listing_id' IS NOT NULL OR current_doc->>'child_index' IS NOT NULL
  OR current_doc->'is_bundle' IS DISTINCT FROM 'false'::jsonb OR current_doc->>'category' IS DISTINCT FROM 'WATCH'
  OR coalesce(current_doc->>'intent','') NOT IN('WTS','WTB')
  OR current_doc->>'raw_message_text' IS NULL OR NOT EXISTS(SELECT 1 FROM unnest(ARRAY['description','title','comments']) field WHERE r.raw_payload->>field=current_doc->>'raw_message_text')
  OR r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence' OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM r.source_hash THEN
  RAISE EXCEPTION 'existing_enrichment_source_or_beforeimage_changed' USING ERRCODE='22023'; END IF;
 values_doc=jsonb_build_object('source_listing_status',r.raw_payload->>'status','source_created_at_text',r.raw_payload->>'created_on');
 values_doc=values_doc||jsonb_build_object('location_country',nullif(btrim(r.raw_payload->>'country'),''),
  'location_region',coalesce(nullif(btrim(r.raw_payload->>'location'),''),nullif(btrim(r.raw_payload->>'region'),'')));
 IF r.raw_payload ? 'deleted_on' THEN values_doc=values_doc||jsonb_build_object('source_deleted',nullif(r.raw_payload->>'deleted_on','') IS NOT NULL);END IF;
 -- Preserve local wall-clock text. A timestamptz requires an explicit source zone.
 IF r.raw_payload->>'created_on' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
  BEGIN
   IF r.raw_payload->>'created_on' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$' THEN
    RAISE EXCEPTION 'unsupported_source_timestamp_format' USING ERRCODE='22007';END IF;
   PERFORM (r.raw_payload->>'created_on')::timestamptz;
   -- Keep the exact microseconds and source offset in the reviewed patch;
   -- the typed record conversion below binds the actual persisted value.
   values_doc=values_doc||jsonb_build_object('source_created_at',r.raw_payload->>'created_on');
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN conflicts=conflicts||'"INVALID_EXPLICIT_SOURCE_TIMESTAMP"'::jsonb;END;
 END IF;
 IF p_candidate IS NULL AND p_version IS NOT NULL THEN RAISE EXCEPTION 'existing_enrichment_version_without_candidate' USING ERRCODE='22023';END IF;
 IF p_candidate IS NOT NULL THEN
  SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=p_candidate;
  candidate=wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);f=candidate->'fields';
  IF c.raw_row_id IS DISTINCT FROM p_raw OR c.source_hash IS DISTINCT FROM r.source_hash OR c.kind IS DISTINCT FROM 'SINGLE'
   OR (current_doc->>'brand',current_doc->>'reference',current_doc->>'intent') IS DISTINCT FROM (f->>'brand',f->>'reference',f->>'intent') THEN
   RAISE EXCEPTION 'existing_enrichment_candidate_identity_or_scope_changed' USING ERRCODE='22023';END IF;
  -- Candidate verification establishes the exact own availability marker. Patch
  -- only the former raw status (or a gap); preserve any separately corrected state.
  IF f->>'source_status' IS DISTINCT FROM r.raw_payload->>'status' THEN
   IF current_doc->>'source_listing_status' IS NULL OR current_doc->>'source_listing_status' IS NOT DISTINCT FROM r.raw_payload->>'status' THEN
    patch=patch||jsonb_build_object('source_listing_status',f->'source_status');
   ELSIF current_doc->>'source_listing_status' IS DISTINCT FROM f->>'source_status' THEN
    conflicts=conflicts||'"PRESERVED_CONFLICTING_SOURCE_AVAILABILITY"'::jsonb;
   END IF;
   values_doc=values_doc||jsonb_build_object('source_listing_status',f->'source_status');
  END IF;
  FOREACH k IN ARRAY ARRAY['model','dial_color','year','condition'] LOOP
   IF current_doc->>k IS NOT NULL AND f->>k IS NOT NULL AND current_doc->k IS DISTINCT FROM f->k THEN conflicts=conflicts||to_jsonb(k);
   ELSE values_doc=values_doc||jsonb_build_object(k,f->k);END IF;
  END LOOP;
  IF p_version IS NOT NULL THEN
   SELECT * INTO STRICT v FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=p_version;
   IF v.candidate_hash IS DISTINCT FROM p_candidate OR v.raw_row_id IS DISTINCT FROM p_raw OR v.listing_id IS DISTINCT FROM p_listing
    OR wf_canonical_staging.materialize_expanded_candidate_v3(p_candidate,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'existing_enrichment_materialization_changed' USING ERRCODE='22023';END IF;
   price_conflict=(current_doc->>'original_price_amount' IS NOT NULL AND (current_doc->>'original_price_amount')::numeric IS DISTINCT FROM (v.document->>'original_price_amount')::numeric)
    OR (current_doc->>'original_price_currency' IS NOT NULL AND current_doc->>'original_price_currency' IS DISTINCT FROM v.document->>'original_price_currency')
    OR (current_doc->>'original_price_role' IS NOT NULL AND current_doc->>'original_price_role' IS DISTINCT FROM v.document->>'original_price_role');
   IF price_conflict THEN conflicts=conflicts||'"ORIGINAL_PRICE_CONFLICT"'::jsonb;
   ELSE
    has_usd=current_doc->>'price_usd' IS NOT NULL;
    FOREACH k IN ARRAY ARRAY['original_price_text','original_price_amount','original_price_currency','original_price_role','price_usd','fx_rate','fx_source','fx_date'] LOOP
     IF NOT(has_usd AND k=ANY(ARRAY['price_usd','fx_rate','fx_source','fx_date'])) THEN values_doc=values_doc||jsonb_build_object(k,v.document->k);END IF;
    END LOOP;
    IF NOT has_usd AND v.document->>'original_price_amount' IS NOT NULL THEN
     IF current_doc->'price_status' IS DISTINCT FROM v.document->'price_status' THEN patch=patch||jsonb_build_object('price_status',v.document->'price_status');END IF;
     IF current_doc->>'intent'='WTS' AND (current_doc->>'statistics_exclusion_reason' IS NULL OR current_doc->>'statistics_exclusion_reason'=ANY(ARRAY['PRICE_NOT_SUPPLIED','UNRESOLVED_CURRENCY','SOURCE_CURRENCY_NOT_ESTABLISHED','FX_RATE_UNAVAILABLE'])) THEN
      FOREACH k IN ARRAY ARRAY['price_research_eligible','included_in_statistics','statistics_exclusion_reason'] LOOP
       IF current_doc->k IS DISTINCT FROM v.document->k THEN patch=patch||jsonb_build_object(k,v.document->k);END IF;
      END LOOP;
     ELSIF current_doc->>'intent'='WTS' THEN conflicts=conflicts||'"PRESERVED_NON_PRICE_RESEARCH_EXCLUSION"'::jsonb;END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 FOR k IN SELECT jsonb_object_keys(values_doc) LOOP
  IF current_doc->>k IS NULL AND values_doc->>k IS NOT NULL THEN patch=patch||jsonb_build_object(k,values_doc->k);END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) INTO conflicts FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(conflicts)) reasons;
 RETURN jsonb_build_object('patch',patch,'review_reasons',conflicts,'before_hash',p_before_hash,
  'after_hash',encode(sha256(convert_to(to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,current_doc||patch))::text,'UTF8')),'hex'));
END $$;
COMMIT;
