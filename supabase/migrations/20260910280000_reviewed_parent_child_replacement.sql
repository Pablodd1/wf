-- Exact reviewed replacement of seven canonical parents by chosen children.
-- Hold-only240 is unchanged. Raw, original images and parent lineage are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.reviewed_parent_replacement_approvals_v3 (
 review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 listing_id text NOT NULL, reviewed_row_hash text NOT NULL CHECK(reviewed_row_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(review_manifest_sha256,listing_id)
);
CREATE TABLE wf_canonical_staging.reviewed_parent_replacement_batches_v3 (
 batch_key text PRIMARY KEY,request_hash text NOT NULL,review_manifest_sha256 text NOT NULL,
 transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),state text NOT NULL CHECK(state IN('RETIRED','RESTORING','RESTORED')),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wf_canonical_staging.reviewed_parent_replacement_rows_v3 (
 batch_key text NOT NULL REFERENCES wf_canonical_staging.reviewed_parent_replacement_batches_v3(batch_key),
 listing_id text NOT NULL,raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_id text NOT NULL,source_hash text NOT NULL,before_state jsonb NOT NULL,before_state_hash text NOT NULL,
 reviewed_request jsonb NOT NULL,lineage_before_hash text,
 PRIMARY KEY(batch_key,listing_id),CHECK(encode(sha256(convert_to(before_state::text,'UTF8')),'hex')=before_state_hash)
);
CREATE INDEX reviewed_parent_replacement_active_listing_v3 ON wf_canonical_staging.reviewed_parent_replacement_rows_v3(listing_id);
CREATE TABLE wf_canonical_staging.reviewed_parent_replacement_conflicts_v3 (
 batch_key text NOT NULL,listing_id text NOT NULL,observed_transaction xid8 NOT NULL,changed_listing_id text NOT NULL,
 operation text NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_key,listing_id,observed_transaction,changed_listing_id,operation),
 FOREIGN KEY(batch_key,listing_id) REFERENCES wf_canonical_staging.reviewed_parent_replacement_rows_v3(batch_key,listing_id)
);
CREATE TABLE wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 (
 cohort_key text PRIMARY KEY,transaction_id xid8 NOT NULL UNIQUE,batch_keys text[] NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.reviewed_parent_replacement_approvals_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.reviewed_parent_replacement_batches_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.reviewed_parent_replacement_rows_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.reviewed_parent_replacement_conflicts_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_parent_replacement_approvals_v3,wf_canonical_staging.reviewed_parent_replacement_batches_v3,
 wf_canonical_staging.reviewed_parent_replacement_rows_v3,wf_canonical_staging.reviewed_parent_replacement_conflicts_v3,
 wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.retire_reviewed_parent_replacements_v3(p_key text,p_revision bigint,p_review text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;prior wf_canonical_staging.reviewed_parent_replacement_batches_v3;request_hash text;
 x jsonb;s jsonb;r wf_canonical_staging.mariadb_raw_source_rows;old_doc jsonb;source_text text;
 a integer;b integer;deltas jsonb='[]';ids text[]='{}';n integer;v_result jsonb;lineage_hash text;child jsonb;candidate jsonb;c wf_canonical_staging.expanded_listing_candidates_v3;v wf_canonical_staging.expanded_listing_versions_v3;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_revision IS NULL OR p_review IS NULL OR p_review !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'reviewed_parent_replacement_request_invalid' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 7 OR jsonb_array_length(p_rows)<>(SELECT count(DISTINCT e->>'listing_id') FROM jsonb_array_elements(p_rows) e) THEN
  RAISE EXCEPTION 'reviewed_parent_replacement_membership_invalid' USING ERRCODE='22023';END IF;
 request_hash=encode(sha256(convert_to(jsonb_build_array(p_revision,p_review,p_rows)::text,'UTF8')),'hex');
 SELECT q.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision q WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 WHERE batch_key=p_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'reviewed_parent_replacement_replay_changed' USING ERRCODE='22023';END IF;
  RETURN prior.result||jsonb_build_object('state',prior.state,'replayed',true);
 END IF;
 IF revision<>p_revision THEN RAISE EXCEPTION 'reviewed_parent_replacement_revision_changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 FOR x IN SELECT e FROM jsonb_array_elements(p_rows) e ORDER BY e->>'listing_id' LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT (x ?& ARRAY['listing_id','raw_row_id','source_id','source_hash','before_hash','reason','source_evidence','outcome','chosen_children'])
   OR (SELECT count(*) FROM jsonb_object_keys(x))<>9
   OR x->>'listing_id' IS NULL OR x->>'raw_row_id' IS NULL OR x->>'source_id' IS NULL
   OR x->>'source_hash' IS NULL OR x->>'source_hash' !~ '^[a-f0-9]{64}$' OR x->>'before_hash' IS NULL OR x->>'before_hash' !~ '^[a-f0-9]{64}$'
   OR x->>'reason' IS NULL OR length(x->>'reason') NOT BETWEEN 5 AND 200 OR x->>'outcome' IS DISTINCT FROM 'REPLACED'
   OR jsonb_typeof(x->'chosen_children') IS DISTINCT FROM 'array'
   OR jsonb_typeof(x->'source_evidence') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'reviewed_parent_replacement_row_invalid' USING ERRCODE='22023';END IF;
  IF x->>'source_id' NOT IN('00cf472f-5993-4891-9be7-a6c770fc273c','149012ef-a07b-40dd-ab2c-0148014799ce','2a7e755e-62ec-4a8d-9d4a-7d7a28dea1ac','2e5c08df-6087-468b-a11e-c36f33ba8fbd','33f411db-6fde-400c-a21f-3701d0f199ff','76590c2c-8aa4-4387-8f72-48f3c527571b','7a2d51a4-605b-4c4c-bc91-aa3c0dc9358f')
   OR jsonb_array_length(x->'chosen_children') NOT BETWEEN 1 AND 6
   OR jsonb_array_length(x->'chosen_children')<>(SELECT count(DISTINCT e->>'candidate_hash') FROM jsonb_array_elements(x->'chosen_children') e)
   OR jsonb_array_length(x->'chosen_children')<>(SELECT count(DISTINCT e->>'materialization_hash') FROM jsonb_array_elements(x->'chosen_children') e) THEN RAISE EXCEPTION 'reviewed_parent_replacement_chosen_scope_invalid' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_approvals_v3 z WHERE z.review_manifest_sha256=p_review
   AND z.listing_id=x->>'listing_id' AND z.reviewed_row_hash=encode(sha256(convert_to(x::text,'UTF8')),'hex')) THEN
   RAISE EXCEPTION 'reviewed_parent_replacement_not_reviewed' USING ERRCODE='22023';END IF;
  SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=(x->>'raw_row_id')::uuid;
  IF r.source_id IS DISTINCT FROM x->>'source_id' OR r.source_hash IS DISTINCT FROM x->>'source_hash'
   OR r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
   OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
   OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM r.source_hash THEN RAISE EXCEPTION 'reviewed_parent_replacement_source_changed' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(x->'source_evidence') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'reviewed_parent_replacement_evidence_invalid' USING ERRCODE='22023';END IF;
  FOR s IN SELECT e FROM jsonb_array_elements(x->'source_evidence') e LOOP
   IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['field','field_sha256','start','end','offset_unit','end_exclusive','quote','quote_sha256'])
    OR s->>'field' IS NULL OR s->>'field' NOT IN('raw_message','title','description','comments')
    OR s->>'offset_unit' IS DISTINCT FROM 'UNICODE_CODEPOINT' OR s->'end_exclusive' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(s->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'end') IS DISTINCT FROM 'number'
    OR s->>'start' !~ '^[0-9]+$' OR s->>'end' !~ '^[0-9]+$' OR s->>'quote' IS NULL THEN RAISE EXCEPTION 'reviewed_parent_replacement_evidence_shape_invalid' USING ERRCODE='22023';END IF;
   source_text=r.raw_payload->>(s->>'field');a=(s->>'start')::integer;b=(s->>'end')::integer;
   IF source_text IS NULL OR a<0 OR b<=a OR b>char_length(source_text)
    OR encode(sha256(convert_to(source_text,'UTF8')),'hex') IS DISTINCT FROM s->>'field_sha256'
    OR substring(source_text FROM a+1 FOR b-a) IS DISTINCT FROM s->>'quote'
    OR encode(sha256(convert_to(s->>'quote','UTF8')),'hex') IS DISTINCT FROM s->>'quote_sha256' THEN RAISE EXCEPTION 'reviewed_parent_replacement_source_span_changed' USING ERRCODE='22023';END IF;
  END LOOP;
  SELECT to_jsonb(p) INTO STRICT old_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p WHERE listing_id=x->>'listing_id' FOR UPDATE;
  IF encode(sha256(convert_to(old_doc::text,'UTF8')),'hex') IS DISTINCT FROM x->>'before_hash'
   OR old_doc->>'source_id' IS DISTINCT FROM r.source_id OR old_doc->>'source_hash' IS DISTINCT FROM r.source_hash
   OR old_doc->>'raw_message_id' IS DISTINCT FROM r.id::text OR old_doc->'parent_listing_id' IS DISTINCT FROM 'null'::jsonb
   OR old_doc->'child_index' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'reviewed_parent_replacement_beforeimage_changed' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_registry_v3 WHERE listing_id=x->>'listing_id')
   OR EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE parent_listing_id=x->>'listing_id') THEN
   RAISE EXCEPTION 'reviewed_parent_replacement_current_scope_conflict' USING ERRCODE='22023';END IF;
  FOR child IN SELECT e FROM jsonb_array_elements(x->'chosen_children') e LOOP
   IF jsonb_typeof(child) IS DISTINCT FROM 'object' OR NOT(child ?& ARRAY['candidate_hash','materialization_hash']) OR (SELECT count(*) FROM jsonb_object_keys(child))<>2
    OR child->>'candidate_hash' IS NULL OR child->>'candidate_hash' !~ '^[a-f0-9]{64}$' OR child->>'materialization_hash' IS NULL OR child->>'materialization_hash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'reviewed_parent_replacement_child_shape_invalid' USING ERRCODE='22023';END IF;
   SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=child->>'candidate_hash';
   candidate=wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);
   SELECT * INTO STRICT v FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=child->>'materialization_hash';
   IF c.raw_row_id IS DISTINCT FROM r.id OR c.source_hash IS DISTINCT FROM r.source_hash OR c.kind IS DISTINCT FROM 'CHILD'
    OR candidate->>'parser_version' IS DISTINCT FROM 'expanded-evidence-v4-reviewed-specific'
    OR candidate->'decision'->>'trading_floor' IS DISTINCT FROM 'TF_SUPPORTED_CANDIDATE' OR candidate->'decision'->'reasons' IS DISTINCT FROM '[]'::jsonb
    OR v.candidate_hash IS DISTINCT FROM c.candidate_hash OR v.raw_row_id IS DISTINCT FROM r.id OR v.source_hash IS DISTINCT FROM r.source_hash
    OR v.document->>'parent_listing_id' IS DISTINCT FROM x->>'listing_id' OR v.document->>'raw_message_id' IS DISTINCT FROM r.id::text
    OR v.document->>'child_index' IS NULL OR v.document->>'image_key' IS NOT NULL OR v.document->>'image_url' IS NOT NULL OR v.document->>'thumbnail_url' IS NOT NULL
    OR wf_canonical_staging.materialize_expanded_candidate_v3(c.candidate_hash,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM v.materialization_hash
    OR EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=v.listing_id) THEN RAISE EXCEPTION 'reviewed_parent_replacement_child_proof_changed' USING ERRCODE='22023';END IF;
  END LOOP;
  SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)::text,'UTF8')),'hex') INTO lineage_hash
   FROM public.seller_listing_lineage_staging l WHERE l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=x->>'listing_id' AND l.seller_listing_id=r.source_id;
  deltas=deltas||jsonb_build_array(jsonb_build_object('request',x,'before',old_doc,'lineage_hash',lineage_hash));ids=array_append(ids,x->>'listing_id');
 END LOOP;
 v_result=jsonb_build_object('batch_key',p_key,'state','RETIRED','retired',cardinality(ids),'revision_before',revision,'replayed',false);
 INSERT INTO wf_canonical_staging.reviewed_parent_replacement_batches_v3(batch_key,request_hash,review_manifest_sha256,state,result) VALUES(p_key,request_hash,p_review,'RETIRED',v_result);
 INSERT INTO wf_canonical_staging.reviewed_parent_replacement_rows_v3(batch_key,listing_id,raw_row_id,source_id,source_hash,before_state,before_state_hash,reviewed_request,lineage_before_hash)
  SELECT p_key,e->'request'->>'listing_id',(e->'request'->>'raw_row_id')::uuid,e->'request'->>'source_id',e->'request'->>'source_hash',e->'before',e->'request'->>'before_hash',e->'request',e->>'lineage_hash' FROM jsonb_array_elements(deltas) e;
 DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(ids);GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>cardinality(ids) THEN RAISE EXCEPTION 'reviewed_parent_replacement_count_changed';END IF;
 v_result=v_result||jsonb_build_object('revision',(SELECT q.revision FROM wf_canonical_staging.publication_revision q WHERE singleton));
 UPDATE wf_canonical_staging.reviewed_parent_replacement_batches_v3 SET result=v_result WHERE batch_key=p_key;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.retire_reviewed_parent_replacements_v3(text,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.record_reviewed_parent_replacement_conflict_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Statement transition tables keep this guard bounded to each publication
 -- batch instead of running a separate lookup for every child row.
 IF TG_OP<>'DELETE' THEN
  INSERT INTO wf_canonical_staging.reviewed_parent_replacement_conflicts_v3(batch_key,listing_id,observed_transaction,changed_listing_id,operation)
   SELECT e.batch_key,e.listing_id,pg_current_xact_id(),p.listing_id,TG_OP
   FROM new_rows p JOIN wf_canonical_staging.reviewed_parent_replacement_rows_v3 e ON e.listing_id=p.listing_id OR e.listing_id=p.parent_listing_id
   JOIN wf_canonical_staging.reviewed_parent_replacement_batches_v3 b USING(batch_key)
   WHERE b.state='RETIRED' AND b.transaction_id<>pg_current_xact_id() ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP<>'INSERT' THEN
  INSERT INTO wf_canonical_staging.reviewed_parent_replacement_conflicts_v3(batch_key,listing_id,observed_transaction,changed_listing_id,operation)
   SELECT e.batch_key,e.listing_id,pg_current_xact_id(),p.listing_id,TG_OP
   FROM old_rows p JOIN wf_canonical_staging.reviewed_parent_replacement_rows_v3 e ON e.listing_id=p.listing_id OR e.listing_id=p.parent_listing_id
   JOIN wf_canonical_staging.reviewed_parent_replacement_batches_v3 b USING(batch_key)
   WHERE b.state='RETIRED' AND b.transaction_id<>pg_current_xact_id() ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.record_reviewed_parent_replacement_conflict_v3() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER reviewed_parent_replacement_insert_conflict_v3 AFTER INSERT ON wf_canonical_staging.mariadb_canary_published_listings_v2
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION wf_canonical_staging.record_reviewed_parent_replacement_conflict_v3();
CREATE TRIGGER reviewed_parent_replacement_update_conflict_v3 AFTER UPDATE ON wf_canonical_staging.mariadb_canary_published_listings_v2
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION wf_canonical_staging.record_reviewed_parent_replacement_conflict_v3();
CREATE TRIGGER reviewed_parent_replacement_delete_conflict_v3 AFTER DELETE ON wf_canonical_staging.mariadb_canary_published_listings_v2
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION wf_canonical_staging.record_reviewed_parent_replacement_conflict_v3();

CREATE FUNCTION wf_canonical_staging.assert_reviewed_parent_replacement_children_v3(p_keys text[],p_expanded text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cohort wf_canonical_staging.expanded_publication_cohorts_v3;
BEGIN
 SELECT * INTO STRICT cohort FROM wf_canonical_staging.expanded_publication_cohorts_v3 WHERE cohort_key=p_expanded;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=e.listing_id WHERE e.batch_key=ANY(p_keys)) THEN RAISE EXCEPTION 'reviewed_parent_replacement_parent_still_published' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e CROSS JOIN LATERAL jsonb_array_elements(e.reviewed_request->'chosen_children') child
  LEFT JOIN wf_canonical_staging.expanded_listing_versions_v3 v ON v.materialization_hash=child->>'materialization_hash' AND v.candidate_hash=child->>'candidate_hash'
  LEFT JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=v.listing_id
  LEFT JOIN wf_canonical_staging.expanded_publication_registry_v3 registry ON registry.listing_id=p.listing_id
  LEFT JOIN wf_canonical_staging.expanded_publication_batch_rows_v3 b ON b.listing_id=p.listing_id AND b.batch_key=ANY(cohort.batch_keys)
  WHERE e.batch_key=ANY(p_keys) AND (p.parent_listing_id IS DISTINCT FROM e.listing_id OR p.raw_message_id IS DISTINCT FROM e.raw_row_id::text OR p.source_hash IS DISTINCT FROM e.source_hash
   OR registry.materialization_hash IS DISTINCT FROM child->>'materialization_hash' OR b.materialization_hash IS DISTINCT FROM child->>'materialization_hash'
   OR encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') IS DISTINCT FROM b.after_state_hash)) THEN RAISE EXCEPTION 'reviewed_parent_replacement_chosen_child_missing_or_changed' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.parent_listing_id=e.listing_id
  WHERE e.batch_key=ANY(p_keys) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.reviewed_request->'chosen_children') child JOIN wf_canonical_staging.expanded_listing_versions_v3 v ON v.materialization_hash=child->>'materialization_hash' AND v.candidate_hash=child->>'candidate_hash' WHERE v.listing_id=p.listing_id)) THEN RAISE EXCEPTION 'reviewed_parent_replacement_extra_unreviewed_child' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.assert_reviewed_parent_replacement_children_v3(text[],text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.finalize_reviewed_parent_replacement_cohort_v3(p_key text,p_keys text[],p_expanded text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;n integer;tf uuid;pr uuid;result jsonb;expanded wf_canonical_staging.expanded_publication_cohorts_v3;
BEGIN
 SELECT q.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision q WHERE singleton FOR UPDATE;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_keys IS NULL OR cardinality(p_keys)<1
  OR cardinality(p_keys)<>(SELECT count(DISTINCT k) FROM unnest(p_keys) k) THEN RAISE EXCEPTION 'reviewed_parent_replacement_cohort_invalid' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 WHERE batch_key=ANY(p_keys) AND state='RETIRED' AND transaction_id=pg_current_xact_id();
 IF n<>cardinality(p_keys) OR n<>(SELECT count(*) FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 WHERE state='RETIRED' AND transaction_id=pg_current_xact_id()) THEN RAISE EXCEPTION 'reviewed_parent_replacement_cohort_transaction_changed' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 WHERE batch_key=ANY(p_keys) GROUP BY listing_id HAVING count(*)>1) THEN RAISE EXCEPTION 'reviewed_parent_replacement_duplicate_parent' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT expanded FROM wf_canonical_staging.expanded_publication_cohorts_v3 WHERE cohort_key=p_expanded;
 IF expanded.transaction_id<>pg_current_xact_id() OR (expanded.result->>'revision')::bigint IS DISTINCT FROM revision THEN RAISE EXCEPTION 'reviewed_parent_replacement_expanded_cohort_changed' USING ERRCODE='22023';END IF;
 PERFORM wf_canonical_staging.assert_reviewed_parent_replacement_children_v3(p_keys,p_expanded);
 tf=(expanded.result->>'trading_snapshot')::uuid;pr=(expanded.result->>'price_snapshot')::uuid;
 result=jsonb_build_object('cohort_key',p_key,'revision',revision,'retired',(SELECT sum((b.result->>'retired')::integer) FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 b WHERE batch_key=ANY(p_keys)),'trading_snapshot',tf,'price_snapshot',pr,'expanded_cohort_key',p_expanded);
 INSERT INTO wf_canonical_staging.reviewed_parent_replacement_cohorts_v3(cohort_key,transaction_id,batch_keys,result) VALUES(p_key,pg_current_xact_id(),p_keys,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.finalize_reviewed_parent_replacement_cohort_v3(text,text[],text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.guard_reviewed_parent_replacement_commit_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;current_state text;expanded_key text;
BEGIN
 SELECT state INTO STRICT current_state FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 WHERE batch_key=NEW.batch_key;
 IF current_state='RETIRED' THEN
  IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 WHERE transaction_id=NEW.transaction_id AND NEW.batch_key=ANY(batch_keys)) THEN RAISE EXCEPTION 'reviewed_parent_replacement_not_finalized' USING ERRCODE='23514';END IF;
  SELECT result->>'expanded_cohort_key' INTO STRICT expanded_key FROM wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 WHERE transaction_id=NEW.transaction_id AND NEW.batch_key=ANY(batch_keys);
  PERFORM wf_canonical_staging.assert_reviewed_parent_replacement_children_v3(ARRAY[NEW.batch_key],expanded_key);
 END IF;
 SELECT q.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision q WHERE singleton;
 IF (SELECT count(DISTINCT surface) FROM wf_canonical_staging.keyset_snapshot_registry WHERE publication_revision=revision AND expires_at>now() AND surface IN('trading_floor','price_research'))<>2 THEN RAISE EXCEPTION 'reviewed_parent_replacement_snapshots_missing' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.guard_reviewed_parent_replacement_commit_v3() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER reviewed_parent_replacement_commit_guard_v3 AFTER INSERT ON wf_canonical_staging.reviewed_parent_replacement_batches_v3
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wf_canonical_staging.guard_reviewed_parent_replacement_commit_v3();
CREATE CONSTRAINT TRIGGER reviewed_parent_restoration_commit_guard_v3 AFTER UPDATE OF state ON wf_canonical_staging.reviewed_parent_replacement_batches_v3
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.state IS DISTINCT FROM OLD.state) EXECUTE FUNCTION wf_canonical_staging.guard_reviewed_parent_replacement_commit_v3();

CREATE FUNCTION wf_canonical_staging.restore_reviewed_parent_replacement_cohort_v3(p_key text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;cohort wf_canonical_staging.reviewed_parent_replacement_cohorts_v3;
 b wf_canonical_staging.reviewed_parent_replacement_batches_v3;docs jsonb;restored integer=0;tf uuid;pr uuid;expanded wf_canonical_staging.expanded_publication_cohorts_v3;k text;
BEGIN
 SELECT q.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision q WHERE singleton FOR UPDATE;
 IF p_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'reviewed_parent_restoration_revision_changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 SELECT * INTO STRICT cohort FROM wf_canonical_staging.reviewed_parent_replacement_cohorts_v3 WHERE cohort_key=p_key;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_conflicts_v3 WHERE batch_key=ANY(cohort.batch_keys)) THEN RAISE EXCEPTION 'reviewed_parent_restoration_subsequent_publication_changed' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_batches_v3 WHERE batch_key=ANY(cohort.batch_keys) AND state='RETIRED') THEN
  PERFORM wf_canonical_staging.assert_reviewed_parent_replacement_children_v3(cohort.batch_keys,cohort.result->>'expanded_cohort_key');
  SELECT * INTO STRICT expanded FROM wf_canonical_staging.expanded_publication_cohorts_v3 WHERE cohort_key=cohort.result->>'expanded_cohort_key';
  UPDATE wf_canonical_staging.reviewed_parent_replacement_batches_v3 SET state='RESTORING' WHERE batch_key=ANY(cohort.batch_keys) AND state='RETIRED';
  FOR k IN SELECT key FROM unnest(expanded.batch_keys) WITH ORDINALITY x(key,ordinal) ORDER BY ordinal DESC LOOP
   SELECT q.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision q WHERE singleton;
   PERFORM wf_canonical_staging.rollback_expanded_batch_data_v3(k,revision);
  END LOOP;
 END IF;
 FOR b IN SELECT x.* FROM unnest(cohort.batch_keys) WITH ORDINALITY k(key,ordinal) JOIN wf_canonical_staging.reviewed_parent_replacement_batches_v3 x ON x.batch_key=k.key ORDER BY k.ordinal DESC FOR UPDATE OF x LOOP
  IF b.state='RESTORED' THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_conflicts_v3 WHERE batch_key=b.batch_key)
   OR EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=e.listing_id OR p.parent_listing_id=e.listing_id WHERE e.batch_key=b.batch_key)
   OR EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e JOIN wf_canonical_staging.expanded_publication_registry_v3 p USING(listing_id) WHERE e.batch_key=b.batch_key) THEN RAISE EXCEPTION 'reviewed_parent_restoration_subsequent_publication_changed' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=e.raw_row_id WHERE e.batch_key=b.batch_key AND
   (r.source_hash IS DISTINCT FROM e.source_hash OR r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM e.source_hash)) THEN RAISE EXCEPTION 'reviewed_parent_restoration_source_changed' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e WHERE e.batch_key=b.batch_key AND e.lineage_before_hash IS DISTINCT FROM
   (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.seller_listing_lineage_staging l WHERE l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=e.listing_id AND l.seller_listing_id=e.source_id)) THEN RAISE EXCEPTION 'reviewed_parent_restoration_lineage_changed' USING ERRCODE='22023';END IF;
  SELECT jsonb_agg(before_state ORDER BY listing_id) INTO docs FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 WHERE batch_key=b.batch_key;
  UPDATE wf_canonical_staging.reviewed_parent_replacement_batches_v3 SET state='RESTORED' WHERE batch_key=b.batch_key;
  PERFORM wf_canonical_staging.apply_publication_records_v2(docs);restored=restored+jsonb_array_length(docs);
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.reviewed_parent_replacement_rows_v3 e LEFT JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p USING(listing_id) WHERE e.batch_key=b.batch_key AND encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') IS DISTINCT FROM e.before_state_hash) THEN RAISE EXCEPTION 'reviewed_parent_restoration_roundtrip_changed';END IF;
 END LOOP;
 PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 RETURN jsonb_build_object('cohort_key',p_key,'state','RESTORED','restored',restored,'trading_snapshot',tf,'price_snapshot',pr);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.restore_reviewed_parent_replacement_cohort_v3(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
