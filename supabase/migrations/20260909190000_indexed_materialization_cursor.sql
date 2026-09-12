-- Avoid re-scanning the completed prefix on each generic-planned cursor read.
-- Both branches retain the same ordering, membership and maximum batch size.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.read_materialization_member_window_v2(p_job_name text,p_after uuid,p_limit integer)
RETURNS SETOF wf_canonical_staging.normalization_job_members_v2
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_materialization_batch_limit' USING ERRCODE='22023'; END IF;
 IF p_after IS NULL THEN
  RETURN QUERY SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=p_job_name ORDER BY raw_row_id LIMIT p_limit;
 ELSE
  RETURN QUERY SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=p_job_name AND raw_row_id>p_after ORDER BY raw_row_id LIMIT p_limit;
 END IF;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.read_materialization_member_window_v2(text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE definition text;needle text;
BEGIN
 definition=replace(pg_get_functiondef('public.read_materialization_workflow_batch_v2(text,integer)'::regprocedure),chr(13),'');
 needle=$old$SELECT * FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
   AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT p_limit$old$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'materialization_read_cursor_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,'SELECT * FROM wf_canonical_staging.read_materialization_member_window_v2(j.normalization_job_name,j.cursor_raw_row_id,p_limit)');
 definition=replace(pg_get_functiondef('public.commit_materialization_workflow_batch_v2(text,uuid,uuid,jsonb)'::regprocedure),chr(13),'');
 needle=$old$SELECT raw_row_id,proposal_hash FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=j.normalization_job_name
  AND (j.cursor_raw_row_id IS NULL OR raw_row_id>j.cursor_raw_row_id) ORDER BY raw_row_id LIMIT n$old$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'materialization_commit_cursor_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,'SELECT raw_row_id,proposal_hash FROM wf_canonical_staging.read_materialization_member_window_v2(j.normalization_job_name,j.cursor_raw_row_id,n)');
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
