-- Reconcile only the completed prefix of a fully sealed immutable source boundary.
-- An unfinished member remains a barrier; no cursor may skip it or invent an outcome.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.create_materialization_workflow_v2(p_job_name text,p_normalization_job_name text,p_fx_hash text DEFAULT NULL) RETURNS jsonb
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
 IF NOT FOUND THEN RAISE EXCEPTION 'normalization_boundary_not_complete' USING ERRCODE='22023'; END IF;
 IF n.processed_rows<>n.expected_rows AND NOT EXISTS(
  SELECT 1 FROM wf_canonical_staging.immutable_source_snapshots s
  WHERE s.manifest_sha256=n.immutable_snapshot_sha256 AND s.sealed AND n.capture_run_key IS NULL
   AND n.manifest_sha256=s.manifest_sha256 AND n.expected_rows=(s.manifest->>'rows')::bigint
   AND (s.manifest->>'source_system',s.manifest->>'source_database',s.manifest->>'source_table')
     =(n.source_system,n.source_database,n.source_table)
 ) THEN RAISE EXCEPTION 'normalization_boundary_not_complete' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=p_normalization_job_name AND (n.processed_rows<>n.expected_rows OR outcome NOT IN('PENDING','LEASED')))<>n.expected_rows THEN
  RAISE EXCEPTION 'normalization_boundary_unreconciled' USING ERRCODE='22023'; END IF;
 INSERT INTO wf_canonical_staging.materialization_workflows_v2(job_name,normalization_job_name,fx_evidence_hash,expected_rows)
 VALUES(p_job_name,p_normalization_job_name,p_fx_hash,n.expected_rows);
 RETURN public.get_materialization_workflow_v2(p_job_name);
END $$;

CREATE OR REPLACE FUNCTION public.read_materialization_workflow_batch_v2(p_job_name text,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j wf_canonical_staging.materialization_workflows_v2;members jsonb;waiting boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_materialization_batch_limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM wf_canonical_staging.materialization_workflows_v2 WHERE job_name=p_job_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'materialization_workflow_not_found' USING ERRCODE='22023'; END IF;
 WITH next_members AS MATERIALIZED (
  SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
   AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT p_limit
 ), first_unfinished AS (
  SELECT raw_row_id FROM next_members WHERE outcome IN('PENDING','LEASED') ORDER BY raw_row_id LIMIT 1
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('raw_row_id',m.raw_row_id,'proposal_hash',m.proposal_hash,'outcome',m.outcome,'raw',CASE WHEN m.outcome='NORMALIZED' THEN to_jsonb(r) ELSE NULL END,'existing_image',img.value) ORDER BY m.raw_row_id),'[]'),
  EXISTS(SELECT 1 FROM first_unfinished f WHERE f.raw_row_id=(SELECT raw_row_id FROM next_members ORDER BY raw_row_id LIMIT 1)) INTO members,waiting
 FROM next_members m
 JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id AND r.source_hash=m.source_hash
 JOIN wf_canonical_staging.normalization_jobs_v2 n ON n.job_name=j.normalization_job_name
 LEFT JOIN LATERAL (SELECT jsonb_build_object('evidence_hash',i.evidence_hash,'verified',i.verified) value
  FROM wf_canonical_staging.source_image_evidence_v2 i WHERE i.raw_row_id=r.id AND i.source_hash=r.source_hash AND i.recorded_at>=n.created_at
  ORDER BY i.recorded_at DESC,i.evidence_hash LIMIT 1) img ON m.outcome='NORMALIZED'
 WHERE NOT EXISTS(SELECT 1 FROM first_unfinished blocked WHERE m.raw_row_id>=blocked.raw_row_id);
 RETURN jsonb_build_object('job',public.get_materialization_workflow_v2(p_job_name),'members',members,'waiting_for_normalization',jsonb_array_length(members)=0 AND waiting);
END $$;


DO $migration$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition=replace(pg_get_functiondef('public.commit_materialization_workflow_batch_v2(text,uuid,uuid,jsonb)'::regprocedure),chr(13),'');
 needle='FOR item IN SELECT value FROM jsonb_array_elements(p_members) LOOP';
 replacement=$replacement$IF EXISTS(
  SELECT 1 FROM wf_canonical_staging.normalization_job_members_v2 m
  WHERE m.job_name=j.normalization_job_name AND m.outcome IN('PENDING','LEASED')
   AND m.raw_row_id IN(SELECT (value->>'raw_row_id')::uuid FROM jsonb_array_elements(p_members))
 ) THEN RAISE EXCEPTION 'materialization_waits_for_normalization' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_members) LOOP$replacement$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'materialization_completion_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
