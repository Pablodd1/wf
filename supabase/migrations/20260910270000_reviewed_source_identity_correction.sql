-- One exact reviewed source identity correction. Existing enrichment remains
-- unchanged unless the private owner approval binds this full candidate/version.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.reviewed_existing_identity_corrections_v3 (
 listing_id text NOT NULL,raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_id text NOT NULL CHECK(source_id='3abd01db-aada-44aa-86f9-c66881e93be7'),
 source_hash text NOT NULL CHECK(source_hash='0b36262aada27c0b3aecf276d2827baf8c83d27bf1a803a00adf954ed56b06aa'),
 before_hash text NOT NULL CHECK(before_hash ~ '^[a-f0-9]{64}$'),
 candidate_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_listing_candidates_v3(candidate_hash),
 materialization_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_listing_versions_v3(materialization_hash),
 review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 source_evidence jsonb NOT NULL CHECK(jsonb_typeof(source_evidence)='array' AND jsonb_array_length(source_evidence)=2),
 PRIMARY KEY(listing_id,before_hash,candidate_hash,materialization_hash)
);
ALTER TABLE wf_canonical_staging.reviewed_existing_identity_corrections_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_existing_identity_corrections_v3 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION wf_canonical_staging.propose_existing_enrichment_v3(text,uuid,text,text,text,text)
 RENAME TO propose_existing_enrichment_before_identity270_v3;
CREATE FUNCTION wf_canonical_staging.propose_existing_enrichment_v3(p_listing text,p_raw uuid,p_source_hash text,p_before_hash text,p_candidate text DEFAULT NULL,p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE approval wf_canonical_staging.reviewed_existing_identity_corrections_v3;
 r wf_canonical_staging.mariadb_raw_source_rows;c wf_canonical_staging.expanded_listing_candidates_v3;
 v wf_canonical_staging.expanded_listing_versions_v3;current_doc jsonb;candidate jsonb;patch jsonb;s jsonb;t text;a integer;b integer;roles text[]='{}';
BEGIN
 SELECT * INTO approval FROM wf_canonical_staging.reviewed_existing_identity_corrections_v3
 WHERE listing_id=p_listing AND raw_row_id=p_raw AND source_hash=p_source_hash AND before_hash=p_before_hash AND candidate_hash=p_candidate AND materialization_hash=p_version;
 IF NOT FOUND THEN RETURN wf_canonical_staging.propose_existing_enrichment_before_identity270_v3(p_listing,p_raw,p_source_hash,p_before_hash,p_candidate,p_version);END IF;
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw;
 SELECT to_jsonb(p) INTO STRICT current_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p WHERE listing_id=p_listing;
 IF r.source_id IS DISTINCT FROM approval.source_id OR r.source_hash IS DISTINCT FROM approval.source_hash
  OR r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM approval.source_hash
  OR current_doc->>'source_id' IS DISTINCT FROM r.source_id OR current_doc->>'source_hash' IS DISTINCT FROM r.source_hash OR current_doc->>'raw_message_id' IS DISTINCT FROM r.id::text
  OR encode(sha256(convert_to(current_doc::text,'UTF8')),'hex') IS DISTINCT FROM approval.before_hash
  OR current_doc->>'brand' IS DISTINCT FROM 'Rolex' OR current_doc->>'reference' IS DISTINCT FROM '161946'
  OR current_doc->>'intent' IS DISTINCT FROM 'WTS' OR current_doc->>'category' IS DISTINCT FROM 'WATCH'
  OR current_doc->'is_bundle' IS DISTINCT FROM 'false'::jsonb OR current_doc->>'parent_listing_id' IS NOT NULL OR current_doc->>'child_index' IS NOT NULL
  OR current_doc->>'price_usd' IS NOT NULL OR current_doc->>'original_price_currency' IS NOT NULL
  OR EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE parent_listing_id=p_listing)
  OR EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_registry_v3 WHERE listing_id=p_listing) THEN
  RAISE EXCEPTION 'reviewed_identity270_source_scope_or_beforeimage_changed' USING ERRCODE='22023';END IF;
 FOR s IN SELECT e FROM jsonb_array_elements(approval.source_evidence) e LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['field','field_sha256','start','end','offset_unit','end_exclusive','quote','quote_sha256','role'])
   OR s->>'field' IS DISTINCT FROM 'title' OR s->>'offset_unit' IS DISTINCT FROM 'UNICODE_CODEPOINT' OR s->'end_exclusive' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(s->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'end') IS DISTINCT FROM 'number'
   OR s->>'start' !~ '^[0-9]+$' OR s->>'end' !~ '^[0-9]+$' OR s->>'quote' IS NULL OR s->>'role' IS NULL THEN
   RAISE EXCEPTION 'reviewed_identity270_source_proof_shape_changed' USING ERRCODE='22023';END IF;
  t=r.raw_payload->>(s->>'field');a=(s->>'start')::integer;b=(s->>'end')::integer;
  IF t IS NULL OR a<0 OR b<=a OR b>char_length(t) OR substring(t FROM a+1 FOR b-a) IS DISTINCT FROM s->>'quote'
   OR encode(sha256(convert_to(t,'UTF8')),'hex') IS DISTINCT FROM s->>'field_sha256'
   OR encode(sha256(convert_to(s->>'quote','UTF8')),'hex') IS DISTINCT FROM s->>'quote_sha256'
   OR (s->>'role'='EXPLICIT_SOURCE_MANUFACTURER' AND s->>'quote'<>'Chopard')
   OR (s->>'role'='EXPLICIT_FULL_SOURCE_REFERENCE' AND s->>'quote'<>'Reference 161946-5001')
   OR s->>'role' NOT IN('EXPLICIT_SOURCE_MANUFACTURER','EXPLICIT_FULL_SOURCE_REFERENCE') THEN
   RAISE EXCEPTION 'reviewed_identity270_exact_source_proof_changed' USING ERRCODE='22023';END IF;
  roles=array_append(roles,s->>'role');
 END LOOP;
 IF (SELECT count(DISTINCT x) FROM unnest(roles) x)<>2 THEN RAISE EXCEPTION 'reviewed_identity270_both_source_proofs_required' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=p_candidate;
 candidate=wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);
 SELECT * INTO STRICT v FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=p_version;
 IF c.raw_row_id IS DISTINCT FROM p_raw OR c.source_hash IS DISTINCT FROM r.source_hash OR c.kind IS DISTINCT FROM 'SINGLE'
  OR candidate->>'parser_version' IS DISTINCT FROM 'expanded-evidence-v4-reviewed-specific'
  OR candidate->'fields'->>'brand' IS DISTINCT FROM 'Chopard' OR candidate->'fields'->>'reference' IS DISTINCT FROM '161946-5001'
  OR candidate->'fields'->>'intent' IS DISTINCT FROM 'WTS' OR candidate->'fields'->>'category' IS DISTINCT FROM 'WATCH'
  OR candidate->'fields'->>'model' IS NOT NULL OR candidate->'fields'->>'original_price_currency' IS NOT NULL OR candidate->'fields'->>'price_usd' IS NOT NULL
  OR candidate->'decision'->>'trading_floor' IS DISTINCT FROM 'TF_SUPPORTED_CANDIDATE' OR candidate->'decision'->'reasons' IS DISTINCT FROM '[]'::jsonb
  OR v.candidate_hash IS DISTINCT FROM p_candidate OR v.raw_row_id IS DISTINCT FROM p_raw OR v.source_hash IS DISTINCT FROM r.source_hash OR v.listing_id IS DISTINCT FROM p_listing
  OR v.document->>'brand' IS DISTINCT FROM 'Chopard' OR v.document->>'reference' IS DISTINCT FROM '161946-5001'
  OR v.document->>'price_usd' IS NOT NULL OR v.document->>'original_price_currency' IS NOT NULL
  OR wf_canonical_staging.materialize_expanded_candidate_v3(p_candidate,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM p_version THEN
  RAISE EXCEPTION 'reviewed_identity270_candidate_or_materialization_changed' USING ERRCODE='22023';END IF;
 patch=jsonb_build_object('brand','Chopard','reference','161946-5001');
 RETURN jsonb_build_object('patch',patch,'review_reasons',jsonb_build_array('EXACT_REVIEWED_SOURCE_IDENTITY_CORRECTION_PRESERVE_OTHER_FIELDS'),
  'before_hash',p_before_hash,'after_hash',encode(sha256(convert_to(to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,current_doc||patch))::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.propose_existing_enrichment_v3(text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
