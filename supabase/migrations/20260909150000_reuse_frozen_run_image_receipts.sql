-- Reuse image checks performed during this exact frozen normalization run.
-- Keep raw UUID/hash identity and exclude checks from older source captures.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.read_materialization_workflow_batch_v2(p_job_name text,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j wf_canonical_staging.materialization_workflows_v2;members jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_materialization_batch_limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM wf_canonical_staging.materialization_workflows_v2 WHERE job_name=p_job_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'materialization_workflow_not_found' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('raw_row_id',m.raw_row_id,'proposal_hash',m.proposal_hash,'outcome',m.outcome,'raw',CASE WHEN m.outcome='NORMALIZED' THEN to_jsonb(r) ELSE NULL END,'existing_image',img.value) ORDER BY m.raw_row_id),'[]') INTO members
 FROM (SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
  AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT p_limit) m
 JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id AND r.source_hash=m.source_hash
 JOIN wf_canonical_staging.normalization_jobs_v2 n ON n.job_name=j.normalization_job_name
 LEFT JOIN LATERAL (SELECT jsonb_build_object('evidence_hash',i.evidence_hash,'verified',i.verified) value
  FROM wf_canonical_staging.source_image_evidence_v2 i WHERE i.raw_row_id=r.id AND i.source_hash=r.source_hash AND i.recorded_at>=n.created_at
  ORDER BY i.recorded_at DESC,i.evidence_hash LIMIT 1) img ON m.outcome='NORMALIZED';
 RETURN jsonb_build_object('job',public.get_materialization_workflow_v2(p_job_name),'members',members);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
