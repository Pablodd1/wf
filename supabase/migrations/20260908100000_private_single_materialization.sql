-- Private canonical versions. This migration exposes no new public listings.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.source_posters_v2 (
 identity_key jsonb PRIMARY KEY,
 poster_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
CREATE TABLE wf_canonical_staging.materialized_single_versions_v2 (
 materialization_hash text PRIMARY KEY CHECK(materialization_hash ~ '^[a-f0-9]{64}$'),
 job_name text NOT NULL REFERENCES wf_canonical_staging.normalization_jobs_v2(job_name),
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL, proposal_hash text,
 fx_evidence_hash text REFERENCES wf_canonical_staging.verified_fx_evidence_v2(evidence_hash),
 image_evidence_hash text REFERENCES wf_canonical_staging.source_image_evidence_v2(evidence_hash),
 outcome text NOT NULL CHECK(outcome IN('ELIGIBLE','REVIEW','BUNDLE_HELD','QUARANTINE','ERROR')),
 document jsonb, evidence_document jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materialized_single_versions_v2_members ON wf_canonical_staging.materialized_single_versions_v2(job_name,raw_row_id,recorded_at DESC);
ALTER TABLE wf_canonical_staging.source_posters_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.materialized_single_versions_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.source_posters_v2,wf_canonical_staging.materialized_single_versions_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.materialize_single_member_v2(p_job_name text,p_raw_row_id uuid,p_proposal_hash text,p_fx_hash text,p_image_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m wf_canonical_staging.normalization_job_members_v2; r wf_canonical_staging.mariadb_raw_source_rows;
 p wf_canonical_staging.mariadb_normalized_proposals; fx wf_canonical_staging.verified_fx_evidence_v2;
 img wf_canonical_staging.source_image_evidence_v2; d jsonb; doc jsonb; evidence jsonb; disposition text;
 reasons jsonb='[]'; amount numeric; usd numeric; rate numeric; fx_source text; fx_date date; currency text;
 priced boolean=false; image_ok boolean=false; image_url text; image_key text; price_status text; source_text text;
 v_identity_key jsonb; poster uuid; canonical_id text; materialization_hash text; inserted integer;
BEGIN
 SELECT * INTO m FROM wf_canonical_staging.normalization_job_members_v2
 WHERE job_name=p_job_name AND raw_row_id=p_raw_row_id FOR SHARE;
 IF NOT FOUND OR m.outcome IN('PENDING','LEASED') OR m.proposal_hash IS DISTINCT FROM p_proposal_hash THEN
  RAISE EXCEPTION 'materialization_member_not_committed' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_row_id FOR SHARE;
 disposition=CASE m.outcome WHEN 'NORMALIZED' THEN 'ELIGIBLE' ELSE m.outcome END;
 IF r.source_hash IS DISTINCT FROM m.source_hash OR r.raw_payload_text IS NULL
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence' OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR encode(extensions.digest(convert_to(r.raw_payload_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM m.source_hash THEN
  disposition='QUARANTINE'; reasons='["RAW_CONTENT_UNVERIFIED"]';
 ELSIF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows conflict
   WHERE conflict.source_system=r.source_system AND conflict.source_database=r.source_database AND conflict.source_table=r.source_table
    AND conflict.source_id=r.source_id AND conflict.source_hash<>r.source_hash) THEN
  disposition='QUARANTINE'; reasons='["CONFLICTING_SOURCE_VERSIONS"]';
 ELSIF p_proposal_hash IS NOT NULL THEN
  SELECT * INTO p FROM wf_canonical_staging.mariadb_normalized_proposals
   WHERE source_system=r.source_system AND source_database=r.source_database AND source_table=r.source_table
    AND source_id=r.source_id AND source_hash=r.source_hash FOR SHARE;
  IF NOT FOUND OR p.proposal_hash IS DISTINCT FROM p_proposal_hash OR p.proposal_canonical_json IS NULL
   OR p.proposal_document IS DISTINCT FROM p.proposal_canonical_json::jsonb
   OR encode(extensions.digest(convert_to(p.proposal_canonical_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_proposal_hash THEN
   RAISE EXCEPTION 'materialization_proposal_content_mismatch' USING ERRCODE='22023'; END IF;
  d=p.proposal_document;
  IF (d->>'source_system',d->>'source_database',d->>'source_table',d->>'source_id',d->>'source_hash',d->>'source_record_id')
    IS DISTINCT FROM (r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash,r.source_record_id)
   OR d->>'parser_version' IS DISTINCT FROM 'authoritative-normalizer-v11-category-bound' THEN
   RAISE EXCEPTION 'materialization_normalizer_version_or_identity_mismatch' USING ERRCODE='22023'; END IF;
  reasons=coalesce(d->'review_flags','[]'::jsonb);
  IF d->'is_bundle' IS DISTINCT FROM 'false'::jsonb OR d->>'bundle_parent_id' IS NOT NULL OR d->>'bundle_child_lineage' IS NOT NULL THEN
   disposition='BUNDLE_HELD';
  ELSIF d->'trading_floor_eligible' IS DISTINCT FROM 'true'::jsonb OR d->>'intent' NOT IN('WTS','WTB') THEN disposition='REVIEW';
  ELSE disposition='ELIGIBLE'; END IF;
 END IF;
 IF disposition='ELIGIBLE' THEN
  source_text=r.raw_payload->>(d->>'listing_text_source');
  IF d->>'listing_text_source' NOT IN('description','title','comments') OR source_text IS NULL OR btrim(source_text)=''
   OR d->>'brand' IS NULL OR d->>'reference' IS NULL THEN
   RAISE EXCEPTION 'materialization_source_text_or_identity_missing' USING ERRCODE='22023'; END IF;
  amount=(d->>'original_price_amount')::numeric; currency=d->>'original_price_currency';
  IF amount>0 AND currency='USD' AND d->>'currency_status'='VERIFIED_EXPLICIT_USD' THEN
   usd=round(amount,2);rate=1;fx_source='1:1_PARITY_PROOF';fx_date=(d->>'fx_date')::date;
  ELSIF amount>0 AND currency NOT IN('USD','USDT','$') AND p_fx_hash IS NOT NULL THEN
   SELECT * INTO fx FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=p_fx_hash;
   IF NOT FOUND THEN RAISE EXCEPTION 'materialization_fx_evidence_missing' USING ERRCODE='22023'; END IF;
   rate=(fx.document->'usd_per_unit'->>currency)::numeric;
   IF rate>0 THEN usd=round(amount*rate,2);fx_source='ECB:'||p_fx_hash;fx_date=(fx.document->>'observed_date')::date; END IF;
  END IF;
  priced=coalesce(usd BETWEEN 100 AND 500000 AND d->>'intent'='WTS',false);
  price_status=CASE WHEN usd>0 AND currency='USD' THEN 'VERIFIED_USD' WHEN usd>0 THEN 'EXPLICIT_FX_CONVERTED'
   WHEN amount>0 OR d->>'currency_status'='AMBIGUOUS_BARE_DOLLAR_HELD' THEN 'UNRESOLVED_CURRENCY' ELSE 'PRICE_NOT_SUPPLIED' END;
  IF usd>0 THEN reasons=reasons-'FX_UNRESOLVED_HELD'; END IF;
  IF usd IS NOT NULL AND usd NOT BETWEEN 100 AND 500000 AND NOT reasons ? 'PRICE_OUTLIER_HELD' THEN reasons=reasons||'"PRICE_OUTLIER_HELD"'::jsonb; END IF;
  image_key=d->>'image_key';
  IF p_image_hash IS NOT NULL THEN
   SELECT * INTO img FROM wf_canonical_staging.source_image_evidence_v2 WHERE evidence_hash=p_image_hash;
   IF NOT FOUND OR img.raw_row_id<>r.id OR img.source_hash<>r.source_hash OR img.document->>'image_key' IS DISTINCT FROM image_key THEN
    RAISE EXCEPTION 'materialization_image_evidence_mismatch' USING ERRCODE='22023'; END IF;
   image_ok=img.verified; IF image_ok THEN image_url=img.document->>'candidate_url'; END IF;
  END IF;
  -- Opaque random poster IDs cannot expose or be brute-forced from source phones.
  -- Unknown contacts get a record-specific identity, never a guessed name match.
  v_identity_key=jsonb_build_array(r.source_system,r.source_database,
   CASE WHEN public.normalize_seller_phone_identity(r.raw_payload->>'from_number') IS NOT NULL THEN 'PHONE' ELSE 'SOURCE_RECORD' END,
   coalesce(public.normalize_seller_phone_identity(r.raw_payload->>'from_number'),r.source_table||':'||r.source_id));
  INSERT INTO wf_canonical_staging.source_posters_v2(identity_key) VALUES(v_identity_key) ON CONFLICT DO NOTHING;
  SELECT sp.poster_id INTO poster FROM wf_canonical_staging.source_posters_v2 sp WHERE sp.identity_key=v_identity_key;
  canonical_id='WF-'||encode(extensions.digest(convert_to(jsonb_build_array(r.source_system,r.source_database,r.source_table,r.source_id)::text,'UTF8'),'sha256'),'hex');
  doc=jsonb_build_object('contract_version','v2.0','listing_id',canonical_id,'parent_listing_id',NULL,'child_index',NULL,
   'source_id',r.source_id,'source_hash',r.source_hash,'raw_message_id',r.id,'raw_message_text',source_text,'source_context_text',NULL,
   'source_created_at',d->'posted_at','observed_at',d->'source_observed_at','category','WATCH','brand',d->'brand','model',d->'model',
   'reference',d->'reference','dial_color',d->'dial_color','year',d->'year','condition',d->'condition','intent',d->'intent',
   'intent_status','INTENT_EXPLICIT_'||(d->>'intent'),'title',NULL,'description',source_text,'original_price_text',NULL,
   'original_price_amount',amount,'original_price_currency',currency,'price_usd',usd,'fx_rate',rate,'fx_source',fx_source,'fx_date',fx_date)
  ||jsonb_build_object('price_status',price_status,'price_research_eligible',priced,'included_in_statistics',priced,
   'statistics_exclusion_reason',CASE WHEN d->>'intent'='WTB' THEN 'INTENT_NOT_WTS' WHEN usd IS NULL THEN price_status WHEN NOT priced THEN 'PRICE_OUTLIER_HELD' ELSE NULL END,
   'image_url',image_url,'thumbnail_url',image_url,'image_key',image_key,'image_evidence_type',CASE WHEN image_ok THEN 'SOURCE_LINKED_IMAGE' WHEN image_key IS NOT NULL THEN 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED' ELSE 'NO_IMAGE' END,
   'image_status',CASE WHEN image_ok THEN 'SOURCE_IMAGE_PRESENT' WHEN image_key IS NOT NULL THEN 'SOURCE_IMAGE_UNAVAILABLE' ELSE 'NO_IMAGE' END,
   'seller_id',poster,'seller_display_name',r.raw_payload->'from_name','seller_profile_url',NULL,'seller_review_count',NULL,
   'seller_listing_count',NULL,'seller_wts_count',NULL,'seller_wtb_count',NULL,'contact_available',false,
   'location_country',NULL,'location_region',d->'location','is_bundle',false,'bundle_child_count',NULL,'duplicate_group_id',NULL,
   'review_status',CASE WHEN jsonb_array_length(reasons)>0 THEN 'REVIEW_REQUIRED' ELSE 'REVIEW_NOT_REQUIRED' END,'review_reasons',reasons,
   'test_run_id',CASE WHEN r.raw_payload->'synthetic_fixture'='true'::jsonb THEN 'PIPELINE_V2_SYNTHETIC' ELSE NULL END);
 END IF;
 evidence=jsonb_build_object('contract','wf-private-single-materialization-v2','job_name',p_job_name,'raw_row_id',r.id,'source_hash',m.source_hash,
  'proposal_hash',m.proposal_hash,'fx_evidence_hash',p_fx_hash,'image_evidence_hash',p_image_hash,'outcome',disposition,'reasons',reasons,'document',doc);
 materialization_hash=encode(extensions.digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex');
 INSERT INTO wf_canonical_staging.materialized_single_versions_v2(materialization_hash,job_name,raw_row_id,source_hash,proposal_hash,fx_evidence_hash,image_evidence_hash,outcome,document,evidence_document)
 VALUES(materialization_hash,p_job_name,r.id,m.source_hash,m.proposal_hash,p_fx_hash,p_image_hash,disposition,doc,evidence) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 RETURN jsonb_build_object('raw_row_id',r.id,'materialization_hash',materialization_hash,'outcome',disposition,'inserted',inserted,'identical',1-inserted);
END; $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.materialize_single_batch_v2(p_job_name text,p_members jsonb,p_fx_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item jsonb; results jsonb='[]';
BEGIN
 IF jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'materialization_batch_invalid' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_members) LOOP
  results=results||jsonb_build_array(wf_canonical_staging.materialize_single_member_v2(p_job_name,(item->>'raw_row_id')::uuid,item->>'proposal_hash',p_fx_hash,item->>'image_evidence_hash'));
 END LOOP;
 RETURN results;
END; $$;
REVOKE ALL ON FUNCTION public.materialize_single_batch_v2(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_single_batch_v2(text,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
