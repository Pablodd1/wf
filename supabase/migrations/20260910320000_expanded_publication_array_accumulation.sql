-- Accumulate bounded publication documents and rollback rows in PostgreSQL arrays.
-- Keep every source, candidate, version, image, dealer and cohort verification.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION wf_canonical_staging.publish_expanded_batch_v3(p_key text,p_revision bigint,p_hashes text[],p_disposable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior wf_canonical_staging.expanded_publication_batches_v3; v wf_canonical_staging.expanded_listing_versions_v3;
 r wf_canonical_staging.mariadb_raw_source_rows; c wf_canonical_staging.expanded_listing_candidates_v3;
 revision bigint; request_hash text; old_doc jsonb; old_registry text; old_lineage jsonb; delta jsonb='[]';docs jsonb='[]';doc_items jsonb[]='{}';delta_items jsonb[]='{}';ids text[]='{}';
 n integer; inserted integer=0; identical integer=0; result jsonb;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_revision IS NULL OR p_disposable IS NULL
  OR p_hashes IS NULL OR cardinality(p_hashes) NOT BETWEEN 1 AND 500
  OR cardinality(p_hashes)<>(SELECT count(DISTINCT h) FROM unnest(p_hashes) h) THEN RAISE EXCEPTION 'expanded_batch_request_invalid' USING ERRCODE='22023'; END IF;
 request_hash=encode(sha256(convert_to(jsonb_build_array(p_revision,p_hashes,p_disposable)::text,'UTF8')),'hex');
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE batch_key=p_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'expanded_batch_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'state',prior.state);
 END IF;
 IF revision<>p_revision THEN RAISE EXCEPTION 'expanded_publication_revision_changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 SELECT count(*) INTO n FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes);
 IF n<>cardinality(p_hashes) OR EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes) GROUP BY listing_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'expanded_batch_versions_invalid' USING ERRCODE='22023'; END IF;
 FOR v IN SELECT * FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes) ORDER BY listing_id LOOP
  SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=v.raw_row_id;
  IF (p_disposable AND (to_regnamespace('wf_disposable_legacy') IS NULL OR r.raw_payload->'synthetic_fixture' IS DISTINCT FROM 'true'::jsonb))
   OR (NOT p_disposable AND (r.raw_payload->'synthetic_fixture'='true'::jsonb OR r.source_system LIKE 'SYNTHETIC%')) THEN
   RAISE EXCEPTION 'expanded_disposable_source_boundary_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=v.candidate_hash;
  PERFORM wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);
  IF v.source_hash IS DISTINCT FROM r.source_hash OR v.raw_row_id<>c.raw_row_id
   OR encode(sha256(convert_to(jsonb_build_array(v.candidate_hash,v.document,v.fx_evidence_hash,v.image_evidence_hash)::text,'UTF8')),'hex') IS DISTINCT FROM v.materialization_hash
   OR v.document->>'source_id' IS DISTINCT FROM r.source_id OR v.document->>'source_hash' IS DISTINCT FROM r.source_hash
   OR v.document->>'listing_id' IS DISTINCT FROM v.listing_id THEN RAISE EXCEPTION 'expanded_version_content_invalid' USING ERRCODE='22023'; END IF;
  -- Verify the materializer produces the same source-bound values, including FX.
  IF wf_canonical_staging.materialize_expanded_candidate_v3(v.candidate_hash,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM v.materialization_hash THEN
   RAISE EXCEPTION 'expanded_materialization_rebuild_changed' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(x) INTO old_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE x.listing_id=v.listing_id FOR UPDATE;
  SELECT materialization_hash INTO old_registry FROM wf_canonical_staging.expanded_publication_registry_v3 WHERE listing_id=v.listing_id;
  SELECT to_jsonb(l) INTO old_lineage FROM public.seller_listing_lineage_staging l
   WHERE l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=v.listing_id AND l.seller_listing_id=v.document->>'source_id' FOR UPDATE;
  IF old_doc IS NOT NULL THEN
   IF old_doc=v.document AND old_registry=v.materialization_hash THEN identical=identical+1;CONTINUE; END IF;
   -- Existing reviewed singles and changed source versions need a separate,
   -- explicitly evidenced correction; this additive batch never overwrites them.
   RAISE EXCEPTION 'expanded_existing_listing_requires_version_review' USING ERRCODE='22023';
  END IF;
  IF c.kind='CHILD' AND EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE x.listing_id=v.document->>'parent_listing_id') THEN
   RAISE EXCEPTION 'expanded_parent_still_published_as_single' USING ERRCODE='22023'; END IF;
  doc_items=array_append(doc_items,v.document);ids=array_append(ids,v.listing_id);inserted=inserted+1;
  delta_items=array_append(delta_items,jsonb_build_object('listing_id',v.listing_id,'materialization_hash',v.materialization_hash,'before_state',old_doc,'before_registry_hash',old_registry,'before_lineage',old_lineage));
 END LOOP;
 docs=to_jsonb(doc_items);delta=to_jsonb(delta_items);
 IF inserted>0 THEN
  PERFORM wf_canonical_staging.apply_publication_records_v2(docs);
  INSERT INTO wf_canonical_staging.expanded_publication_registry_v3(listing_id,materialization_hash)
   SELECT x->>'listing_id',x->>'materialization_hash' FROM jsonb_array_elements(delta) x;
  PERFORM public.reconcile_v2_listing_dealers(ids);
 END IF;
 result=jsonb_build_object('batch_key',p_key,'state','APPLIED','input',cardinality(p_hashes),'inserted',inserted,'identical',identical,'revision_before',revision,
  'revision',(SELECT x.revision FROM wf_canonical_staging.publication_revision x WHERE singleton),'replayed',false);
 INSERT INTO wf_canonical_staging.expanded_publication_batches_v3(batch_key,request_hash,state,result) VALUES(p_key,request_hash,'APPLIED',result);
 -- The immutable version already retains the full after-document. Hash-bind it
 -- and lineage here; only prior rows need complete restoration beforeimages.
 INSERT INTO wf_canonical_staging.expanded_publication_batch_rows_v3(batch_key,listing_id,materialization_hash,source_id,before_state,after_state_hash,before_registry_hash,before_lineage,after_lineage_hash)
  SELECT p_key,x->>'listing_id',x->>'materialization_hash',p.source_id,nullif(x->'before_state','null'::jsonb),encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),x->>'before_registry_hash',
   nullif(x->'before_lineage','null'::jsonb),encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex')
  FROM jsonb_array_elements(delta) x JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=x->>'listing_id'
  LEFT JOIN public.seller_listing_lineage_staging l ON l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=p.listing_id AND l.seller_listing_id=p.source_id;
 RETURN result;
END $$;
COMMIT;
