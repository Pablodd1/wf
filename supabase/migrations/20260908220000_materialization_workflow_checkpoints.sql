-- Bounded, optimistic materialization checkpoints. A completed normalization
-- boundary cannot expand; receipt capture is separate from atomic completion.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.materialization_workflows_v2 (
 job_name text PRIMARY KEY CHECK(length(job_name) BETWEEN 1 AND 160),
 normalization_job_name text NOT NULL REFERENCES wf_canonical_staging.normalization_jobs_v2(job_name),
 fx_evidence_hash text REFERENCES wf_canonical_staging.verified_fx_evidence_v2(evidence_hash),
 expected_rows bigint NOT NULL CHECK(expected_rows>0),processed_rows bigint NOT NULL DEFAULT 0,
 eligible_rows bigint NOT NULL DEFAULT 0,review_rows bigint NOT NULL DEFAULT 0,bundle_rows bigint NOT NULL DEFAULT 0,
 quarantine_rows bigint NOT NULL DEFAULT 0,error_rows bigint NOT NULL DEFAULT 0,
 cursor_raw_row_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(processed_rows BETWEEN 0 AND expected_rows),
 CHECK(processed_rows=eligible_rows+review_rows+bundle_rows+quarantine_rows+error_rows)
);
CREATE TABLE wf_canonical_staging.materialization_workflow_members_v2 (
 job_name text NOT NULL REFERENCES wf_canonical_staging.materialization_workflows_v2(job_name),
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 materialization_hash text NOT NULL REFERENCES wf_canonical_staging.materialized_single_versions_v2(materialization_hash),
 outcome text NOT NULL CHECK(outcome IN('ELIGIBLE','REVIEW','BUNDLE_HELD','QUARANTINE','ERROR')),
 image_probe_outcome text NOT NULL,image_evidence_hash text REFERENCES wf_canonical_staging.source_image_evidence_v2(evidence_hash),
 committed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_name,raw_row_id)
);
CREATE TABLE wf_canonical_staging.materialization_workflow_batches_v2 (
 job_name text NOT NULL REFERENCES wf_canonical_staging.materialization_workflows_v2(job_name),request_id uuid NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,committed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_name,request_id)
);
ALTER TABLE wf_canonical_staging.materialization_workflows_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.materialization_workflow_members_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.materialization_workflow_batches_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.materialization_workflows_v2,wf_canonical_staging.materialization_workflow_members_v2,wf_canonical_staging.materialization_workflow_batches_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_materialization_workflow_v2(p_job_name text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(j)||jsonb_build_object('complete',j.processed_rows=j.expected_rows) FROM wf_canonical_staging.materialization_workflows_v2 j WHERE j.job_name=p_job_name;
$$;
CREATE FUNCTION public.create_materialization_workflow_v2(p_job_name text,p_normalization_job_name text,p_fx_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j wf_canonical_staging.materialization_workflows_v2;n wf_canonical_staging.normalization_jobs_v2;
BEGIN
 IF p_job_name IS NULL OR length(p_job_name) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_materialization_job' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('materialization-workflow:'||p_job_name,0));
 SELECT * INTO j FROM wf_canonical_staging.materialization_workflows_v2 WHERE job_name=p_job_name;
 IF FOUND THEN
  IF (j.normalization_job_name,j.fx_evidence_hash) IS DISTINCT FROM (p_normalization_job_name,p_fx_hash) THEN RAISE EXCEPTION 'materialization_workflow_config_changed' USING ERRCODE='22023'; END IF;
  RETURN public.get_materialization_workflow_v2(p_job_name);
 END IF;
 SELECT * INTO n FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name=p_normalization_job_name FOR SHARE;
 IF NOT FOUND OR n.processed_rows<>n.expected_rows THEN RAISE EXCEPTION 'normalization_boundary_not_complete' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=p_normalization_job_name AND outcome NOT IN('PENDING','LEASED'))<>n.expected_rows THEN
  RAISE EXCEPTION 'normalization_boundary_unreconciled' USING ERRCODE='22023'; END IF;
 INSERT INTO wf_canonical_staging.materialization_workflows_v2(job_name,normalization_job_name,fx_evidence_hash,expected_rows)
 VALUES(p_job_name,p_normalization_job_name,p_fx_hash,n.expected_rows);
 RETURN public.get_materialization_workflow_v2(p_job_name);
END $$;

CREATE FUNCTION public.read_materialization_workflow_batch_v2(p_job_name text,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j wf_canonical_staging.materialization_workflows_v2;members jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'invalid_materialization_batch_limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM wf_canonical_staging.materialization_workflows_v2 WHERE job_name=p_job_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'materialization_workflow_not_found' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('raw_row_id',m.raw_row_id,'proposal_hash',m.proposal_hash,'outcome',m.outcome,'raw',to_jsonb(r),'existing_image',img.value) ORDER BY m.raw_row_id),'[]') INTO members
 FROM (SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
  AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT p_limit) m
 JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id
 LEFT JOIN LATERAL (SELECT jsonb_build_object('evidence_hash',i.evidence_hash,'verified',i.verified) value
  FROM wf_canonical_staging.source_image_evidence_v2 i WHERE i.raw_row_id=r.id AND i.source_hash=r.source_hash AND i.recorded_at>=j.created_at
  ORDER BY i.recorded_at DESC,i.evidence_hash LIMIT 1) img ON true;
 RETURN jsonb_build_object('job',public.get_materialization_workflow_v2(p_job_name),'members',members);
END $$;

CREATE FUNCTION public.commit_materialization_workflow_batch_v2(p_job_name text,p_expected_cursor uuid,p_request_id uuid,p_members jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j wf_canonical_staging.materialization_workflows_v2;prior wf_canonical_staging.materialization_workflow_batches_v2;
 n integer;expected jsonb;provided jsonb;item jsonb;v_result jsonb;request_hash text;response jsonb;last_id uuid;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION 'invalid_materialization_completion' USING ERRCODE='22023'; END IF;
 request_hash=encode(sha256(convert_to(jsonb_build_array(p_expected_cursor,p_members)::text,'UTF8')),'hex');
 SELECT * INTO j FROM wf_canonical_staging.materialization_workflows_v2 WHERE job_name=p_job_name FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'materialization_workflow_not_found' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM wf_canonical_staging.materialization_workflow_batches_v2 WHERE job_name=p_job_name AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.request_hash<>request_hash THEN RAISE EXCEPTION 'materialization_batch_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 IF j.cursor_raw_row_id IS DISTINCT FROM p_expected_cursor OR j.processed_rows=j.expected_rows THEN RAISE EXCEPTION 'materialization_checkpoint_changed' USING ERRCODE='22023'; END IF;
 n=jsonb_array_length(p_members);
 SELECT jsonb_agg(jsonb_build_array(m.raw_row_id,m.proposal_hash) ORDER BY m.raw_row_id) INTO expected
 FROM(SELECT raw_row_id,proposal_hash FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
  AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT n) m;
 SELECT jsonb_agg(jsonb_build_array(value->>'raw_row_id',value->>'proposal_hash') ORDER BY ordinal) INTO provided FROM jsonb_array_elements(p_members) WITH ORDINALITY a(value,ordinal);
 IF expected IS DISTINCT FROM provided THEN RAISE EXCEPTION 'materialization_batch_membership_mismatch' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_members) LOOP
  IF item->>'image_probe_outcome' IS NULL OR item->>'image_probe_outcome' NOT IN('NOT_APPLICABLE','NO_SOURCE_IMAGE','SOURCE_IMAGE_KEY_REQUIRES_REVIEW','SOURCE_IMAGE_UNAVAILABLE','VERIFIED_SOURCE_IMAGE','SOURCE_PROVENANCE_REQUIRES_REVIEW') THEN
   RAISE EXCEPTION 'invalid_materialization_image_outcome' USING ERRCODE='22023'; END IF;
  v_result=wf_canonical_staging.materialize_single_member_v2(j.normalization_job_name,(item->>'raw_row_id')::uuid,item->>'proposal_hash',j.fx_evidence_hash,item->>'image_evidence_hash');
  INSERT INTO wf_canonical_staging.materialization_workflow_members_v2(job_name,raw_row_id,materialization_hash,outcome,image_probe_outcome,image_evidence_hash)
  VALUES(p_job_name,(item->>'raw_row_id')::uuid,v_result->>'materialization_hash',v_result->>'outcome',item->>'image_probe_outcome',item->>'image_evidence_hash');
  UPDATE wf_canonical_staging.materialization_workflows_v2 SET
   eligible_rows=eligible_rows+(v_result->>'outcome'='ELIGIBLE')::int,review_rows=review_rows+(v_result->>'outcome'='REVIEW')::int,
   bundle_rows=bundle_rows+(v_result->>'outcome'='BUNDLE_HELD')::int,quarantine_rows=quarantine_rows+(v_result->>'outcome'='QUARANTINE')::int,
   error_rows=error_rows+(v_result->>'outcome'='ERROR')::int,processed_rows=processed_rows+1,
   cursor_raw_row_id=(item->>'raw_row_id')::uuid,updated_at=now() WHERE job_name=p_job_name;
 END LOOP;
 response=jsonb_build_object('job',public.get_materialization_workflow_v2(p_job_name),'processed',n,'replayed',false);
 INSERT INTO wf_canonical_staging.materialization_workflow_batches_v2(job_name,request_id,request_hash,result) VALUES(p_job_name,p_request_id,request_hash,response);
 RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.get_materialization_workflow_v2(text),public.create_materialization_workflow_v2(text,text,text),public.read_materialization_workflow_batch_v2(text,integer),public.commit_materialization_workflow_batch_v2(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_materialization_workflow_v2(text),public.create_materialization_workflow_v2(text,text,text),public.read_materialization_workflow_batch_v2(text,integer),public.commit_materialization_workflow_batch_v2(text,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
