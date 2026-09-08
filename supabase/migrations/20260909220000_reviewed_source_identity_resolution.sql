-- Exact reviewed identity decisions supplement immutable source/proposal evidence.
-- Nothing is published, withdrawn, or changed by installing this migration.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.reviewed_source_identity_resolutions_v2 (
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,proposal_hash text NOT NULL,
 resolution_hash text NOT NULL UNIQUE CHECK(resolution_hash ~ '^[0-9a-f]{64}$'),
 evidence_document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(raw_row_id,source_hash,proposal_hash),
 CHECK(encode(sha256(convert_to(evidence_document::text,'UTF8')),'hex')=resolution_hash),
 CHECK(evidence_document->>'contract'='WF_REVIEWED_SOURCE_IDENTITY_V1'),
 CHECK((evidence_document->>'raw_row_id')::uuid=raw_row_id),
 CHECK(evidence_document->>'source_hash'=source_hash),
 CHECK(evidence_document->>'proposal_hash'=proposal_hash),
 CHECK(evidence_document->>'approved_outcome' IN('ELIGIBLE','REVIEW'))
);
ALTER TABLE wf_canonical_staging.reviewed_source_identity_resolutions_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_source_identity_resolutions_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.resolve_reviewed_source_identity_v2(p_raw_row_id uuid,p_proposal_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $resolver$
DECLARE r wf_canonical_staging.mariadb_raw_source_rows;p wf_canonical_staging.mariadb_normalized_proposals;
 reviewed wf_canonical_staging.reviewed_source_identity_resolutions_v2;proof jsonb;d jsonb;t text;ref text;
BEGIN
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_row_id;
 SELECT * INTO STRICT p FROM wf_canonical_staging.mariadb_normalized_proposals
 WHERE (source_system,source_database,source_table,source_id,source_hash)
  =(r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash) AND proposal_hash=p_proposal_hash;
 t=r.raw_payload->>(p.proposal_document->>'listing_text_source');
 proof=wf_canonical_staging.review_single_source_identity_v2(p.proposal_document,t)
  ||jsonb_build_object('brand',p.proposal_document->'brand','reference',p.proposal_document->'reference','resolution_hash',NULL);
 SELECT * INTO reviewed FROM wf_canonical_staging.reviewed_source_identity_resolutions_v2
 WHERE raw_row_id=r.id AND source_hash=r.source_hash AND proposal_hash=p.proposal_hash;
 IF NOT FOUND THEN
  IF p.proposal_document->>'reference' ~ '^(19|20)[0-9]{2}[-/]([0-9]{2}|(19|20)[0-9]{2})$' THEN
   RETURN proof||jsonb_build_object('outcome','REVIEW','reasons',(proof->'reasons')||'"REFERENCE_IS_YEAR_RANGE"'::jsonb);
  END IF;
  RETURN proof;
 END IF;
 d=reviewed.evidence_document;ref=d->>'approved_reference';
 IF encode(sha256(convert_to(d::text,'UTF8')),'hex') IS DISTINCT FROM reviewed.resolution_hash
  OR d->>'source_text_sha256' IS DISTINCT FROM encode(sha256(convert_to(t,'UTF8')),'hex')
  OR d->'expected_brand' IS DISTINCT FROM p.proposal_document->'brand'
  OR d->'expected_model' IS DISTINCT FROM proof->'model'
  OR d->'expected_reference' IS DISTINCT FROM p.proposal_document->'reference'
  OR d->>'reason' IS NULL OR length(d->>'reason') NOT BETWEEN 1 AND 1000
  OR d->>'review_manifest_sha256' !~ '^[0-9a-f]{64}$'
  OR r.source_hash IS DISTINCT FROM encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex')
  OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR p.proposal_hash IS DISTINCT FROM encode(sha256(convert_to(p.proposal_canonical_json,'UTF8')),'hex')
  OR p.proposal_canonical_json::jsonb IS DISTINCT FROM p.proposal_document THEN
  RAISE EXCEPTION 'reviewed_identity_evidence_changed' USING ERRCODE='22023'; END IF;
 IF d->>'approved_outcome'='ELIGIBLE' THEN
  -- A reviewer may select only a complete, exact source token. A substring of
  -- a different reference and a year/year range cannot become watch identity.
  IF proof->>'outcome'<>'ELIGIBLE' OR ref IS NULL OR length(ref) NOT BETWEEN 2 AND 80
   OR ref !~ '^[[:alnum:]][[:alnum:] ./-]*[[:alnum:]]$' OR ref !~ '[0-9]'
   OR ref ~ '^(19|20)[0-9]{2}[-/]([0-9]{2}|(19|20)[0-9]{2})$'
   OR ref ~ '^(19|20)[0-9]{2}$'
   OR NOT EXISTS(SELECT 1 FROM generate_series(1,greatest(length(t)-length(ref)+1,0)) pos
    WHERE lower(substr(t,pos,length(ref)))=lower(ref)
     AND (pos=1 OR substr(t,pos-1,1) !~ '[[:alnum:]]')
     AND (pos+length(ref)>length(t) OR substr(t,pos+length(ref),1) !~ '[[:alnum:]]')) THEN
   RAISE EXCEPTION 'reviewed_identity_reference_not_source_exact' USING ERRCODE='22023'; END IF;
 ELSIF d->>'approved_outcome'<>'REVIEW' OR ref IS NOT NULL THEN
  RAISE EXCEPTION 'reviewed_identity_outcome_invalid' USING ERRCODE='22023';
 END IF;
 RETURN proof||jsonb_build_object('outcome',d->>'approved_outcome','reference',ref,
  'resolution_hash',reviewed.resolution_hash,'reasons',(proof->'reasons')||jsonb_build_array(d->>'reason'));
END $resolver$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_reviewed_source_identity_v2(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.record_reviewed_source_identity_v2(p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $record$
DECLARE h text;prior wf_canonical_staging.reviewed_source_identity_resolutions_v2;proof jsonb;
BEGIN
 IF p_document IS NULL OR p_document->>'contract' IS DISTINCT FROM 'WF_REVIEWED_SOURCE_IDENTITY_V1'
  OR p_document->>'raw_row_id' IS NULL OR p_document->>'source_hash' IS NULL OR p_document->>'proposal_hash' IS NULL
  OR coalesce(p_document->>'source_hash','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_document->>'proposal_hash','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_document->>'source_text_sha256','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_document->>'review_manifest_sha256','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_document->>'approved_outcome','') NOT IN('ELIGIBLE','REVIEW') THEN
  RAISE EXCEPTION 'reviewed_identity_request_invalid' USING ERRCODE='22023'; END IF;
 h=encode(sha256(convert_to(p_document::text,'UTF8')),'hex');
 INSERT INTO wf_canonical_staging.reviewed_source_identity_resolutions_v2(raw_row_id,source_hash,proposal_hash,resolution_hash,evidence_document)
 VALUES((p_document->>'raw_row_id')::uuid,p_document->>'source_hash',p_document->>'proposal_hash',h,p_document) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.reviewed_source_identity_resolutions_v2
 WHERE raw_row_id=(p_document->>'raw_row_id')::uuid AND source_hash=p_document->>'source_hash' AND proposal_hash=p_document->>'proposal_hash';
 IF prior.resolution_hash<>h THEN RAISE EXCEPTION 'reviewed_identity_replay_changed' USING ERRCODE='22023'; END IF;
 proof=wf_canonical_staging.resolve_reviewed_source_identity_v2(prior.raw_row_id,prior.proposal_hash);
 IF proof->>'resolution_hash' IS DISTINCT FROM h THEN RAISE EXCEPTION 'reviewed_identity_source_not_current' USING ERRCODE='22023'; END IF;
 RETURN proof;
END $record$;
REVOKE ALL ON FUNCTION wf_canonical_staging.record_reviewed_source_identity_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text;needle text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)'::regprocedure),chr(13),'');
 needle='identity_review=wf_canonical_staging.review_single_source_identity_v2(d,r.raw_payload->>(d->>''listing_text_source''));';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_identity_materializer_definition_mismatch'; END IF;
 definition=replace(definition,needle,'identity_review=wf_canonical_staging.resolve_reviewed_source_identity_v2(r.id,p_proposal_hash);');
 needle='d=jsonb_set(d,''{model}'',identity_review->''model'');';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_identity_materializer_document_mismatch'; END IF;
 definition=replace(definition,needle,needle||E'\n  d=jsonb_set(d,''{reference}'',identity_review->''reference'');');
 needle='materialization_hash=encode(extensions.digest(convert_to(evidence::text,''UTF8''),''sha256''),''hex'');';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_identity_materializer_hash_mismatch'; END IF;
 definition=replace(definition,needle,E'IF identity_review->>''resolution_hash'' IS NOT NULL THEN evidence=evidence||jsonb_build_object(''identity_resolution_hash'',identity_review->>''resolution_hash''); END IF;\n '||needle);
 EXECUTE definition;
 definition=replace(pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure),chr(13),'');
 needle='wf_canonical_staging.review_single_source_identity_v2(p.proposal_document,r.raw_payload->>(p.proposal_document->>''listing_text_source''))';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_identity_publisher_definition_mismatch'; END IF;
 definition=replace(definition,needle,'wf_canonical_staging.resolve_reviewed_source_identity_v2(r.id,v.proposal_hash)');
 needle='AND v.document->''reference'' IS NOT DISTINCT FROM p.proposal_document->''reference''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_identity_publisher_reference_mismatch'; END IF;
 definition=replace(definition,needle,'AND v.document->''reference'' IS NOT DISTINCT FROM identity_check.proof->''reference'''||E'\n    AND v.evidence_document->>''identity_resolution_hash'' IS NOT DISTINCT FROM identity_check.proof->>''resolution_hash''');
 EXECUTE definition;
END $patch$;

-- Deleted public rows have a SQL NULL after_state, so the existing rollback
-- function proves continued absence and restores their exact before_state.
ALTER TABLE wf_canonical_staging.publication_batch_rows_v2 ALTER COLUMN after_state DROP NOT NULL;
ALTER TABLE wf_canonical_staging.publication_batch_rows_v2 ADD CONSTRAINT publication_delta_nonempty_v2 CHECK(before_state IS NOT NULL OR after_state IS NOT NULL);
CREATE FUNCTION public.withdraw_reviewed_identity_batch_v2(p_batch_key text,p_expected_revision bigint,p_rows jsonb,p_disposable boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $withdraw$
DECLARE prior wf_canonical_staging.publication_batches_v2;revision bigint;request jsonb;h text;item jsonb;
 v wf_canonical_staging.materialized_single_versions_v2;before_doc jsonb;proof jsonb;before_count bigint;n integer;tf uuid;pr uuid;v_result jsonb;
BEGIN
 IF p_batch_key IS NULL OR p_batch_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_expected_revision IS NULL OR p_disposable IS NULL
  OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500
  OR jsonb_array_length(p_rows)<>(SELECT count(DISTINCT e->>'listing_id') FROM jsonb_array_elements(p_rows)e) THEN
  RAISE EXCEPTION 'identity_withdrawal_request_invalid' USING ERRCODE='22023'; END IF;
 IF p_disposable AND to_regnamespace('wf_disposable_legacy') IS NULL THEN RAISE EXCEPTION 'disposable_publication_target_refused' USING ERRCODE='22023'; END IF;
 request=jsonb_build_object('expected_revision',p_expected_revision,'rows',p_rows,'disposable',p_disposable);
 h=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 SELECT r.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision r WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.publication_batches_v2 WHERE batch_key=p_batch_key FOR UPDATE;
 IF FOUND THEN
  IF prior.request_hash<>h THEN RAISE EXCEPTION 'identity_withdrawal_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('state',prior.state,'replayed',true);
 END IF;
 IF revision<>p_expected_revision THEN RAISE EXCEPTION 'publication_revision_changed' USING ERRCODE='40001'; END IF;
 SELECT count(*) INTO before_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
 INSERT INTO wf_canonical_staging.publication_batches_v2(batch_key,request_hash,state,result,request_document)
 VALUES(p_batch_key,h,'APPLIED','{}',request);
 FOR item IN SELECT e FROM jsonb_array_elements(p_rows)e LOOP
  SELECT * INTO STRICT v FROM wf_canonical_staging.materialized_single_versions_v2 WHERE materialization_hash=item->>'materialization_hash';
  SELECT to_jsonb(c) INTO before_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE listing_id=item->>'listing_id' FOR UPDATE;
  proof=wf_canonical_staging.resolve_reviewed_source_identity_v2(v.raw_row_id,v.proposal_hash);
  IF before_doc IS NULL OR before_doc->>'source_hash' IS DISTINCT FROM v.source_hash OR before_doc->>'raw_message_id' IS DISTINCT FROM v.raw_row_id::text
   OR item->>'expected_publication_sha256' IS DISTINCT FROM encode(sha256(convert_to(before_doc::text,'UTF8')),'hex')
   OR v.outcome<>'REVIEW' OR proof->>'outcome'<>'REVIEW' OR proof->>'resolution_hash' IS NULL
   OR v.evidence_document->>'identity_resolution_hash' IS DISTINCT FROM proof->>'resolution_hash'
   OR v.materialization_hash IS DISTINCT FROM encode(sha256(convert_to(v.evidence_document::text,'UTF8')),'hex')
   OR v.evidence_document->>'outcome' IS DISTINCT FROM v.outcome OR v.evidence_document->'document' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'identity_withdrawal_evidence_changed' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows r WHERE r.id=v.raw_row_id
   AND coalesce(r.raw_payload->'synthetic_fixture'='true'::jsonb,false) IS DISTINCT FROM p_disposable) THEN
   RAISE EXCEPTION 'identity_withdrawal_target_refused' USING ERRCODE='22023'; END IF;
  INSERT INTO wf_canonical_staging.publication_batch_rows_v2(batch_key,listing_id,materialization_hash,before_state,after_state)
  VALUES(p_batch_key,item->>'listing_id',v.materialization_hash,before_doc,NULL);
 END LOOP;
 DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c USING wf_canonical_staging.publication_batch_rows_v2 b WHERE b.batch_key=p_batch_key AND b.listing_id=c.listing_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>jsonb_array_length(p_rows) OR (SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2)<>before_count-n THEN RAISE EXCEPTION 'identity_withdrawal_count_mismatch'; END IF;
 -- Only traversal expiry changes. Frozen members, payloads and caches remain.
 UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=now() WHERE expires_at>now();
 tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 SELECT r.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision r WHERE singleton;
 v_result=jsonb_build_object('batch_key',p_batch_key,'state','APPLIED','input',n,'inserted',0,'identical',0,'changed',0,'held',n,'withdrawn',n,
  'before_count',before_count,'after_count',before_count-n,'revision',revision,'trading_snapshot',tf,'price_snapshot',pr,'replayed',false);
 UPDATE wf_canonical_staging.publication_batches_v2 SET result=v_result WHERE batch_key=p_batch_key;
 RETURN v_result;
END $withdraw$;
REVOKE ALL ON FUNCTION public.withdraw_reviewed_identity_batch_v2(text,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE definition text;needle text='IF (batch.result->>''inserted'')::bigint+(batch.result->>''changed'')::bigint=0 THEN RETURN NULL; END IF;';
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.guard_publication_snapshot_commit_v2()'::regprocedure),chr(13),'');
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'identity_withdrawal_commit_guard_mismatch'; END IF;
 EXECUTE replace(definition,needle,'IF coalesce((batch.result->>''inserted'')::bigint,0)+coalesce((batch.result->>''changed'')::bigint,0)+coalesce((batch.result->>''withdrawn'')::bigint,0)=0 THEN RETURN NULL; END IF;');
END $guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
