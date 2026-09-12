-- Seek pending and expired members through the existing (job,outcome,raw UUID) index.
-- Preserve the global UUID order, job lock, row locks, lease replay and retry limit.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.claim_normalization_batch_v2(p_job_name text,p_lease_id uuid,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; result jsonb; job wf_canonical_staging.normalization_jobs_v2;
BEGIN
 IF p_lease_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'invalid_normalization_claim' USING ERRCODE='22023'; END IF;
 SELECT * INTO job FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name=p_job_name FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'normalization_job_not_found' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.normalization_job_batches_v2 WHERE lease_id=p_lease_id) THEN
  RAISE EXCEPTION 'normalization_lease_already_committed' USING ERRCODE='22023'; END IF;
 -- Expired work is bounded; exhausted attempts become durable errors.
 WITH exhausted AS (
  SELECT raw_row_id FROM wf_canonical_staging.normalization_job_members_v2
  WHERE job_name=p_job_name AND outcome='LEASED' AND lease_expires_at<=clock_timestamp() AND attempts=3
  ORDER BY raw_row_id LIMIT 500 FOR UPDATE
 ) UPDATE wf_canonical_staging.normalization_job_members_v2 m
 SET outcome='ERROR',error_code='WORKER_RETRY_EXHAUSTED',completed_at=now(),lease_id=NULL,lease_expires_at=NULL
 FROM exhausted e WHERE m.job_name=p_job_name AND m.raw_row_id=e.raw_row_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE wf_canonical_staging.normalization_jobs_v2 SET processed_rows=processed_rows+n,error_rows=error_rows+n,updated_at=now()
 WHERE job_name=p_job_name AND n>0;
 IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=p_job_name AND lease_id=p_lease_id) THEN
  WITH pending AS (
   SELECT m.raw_row_id FROM wf_canonical_staging.normalization_job_members_v2 m
   JOIN (
    (SELECT raw_row_id FROM wf_canonical_staging.normalization_job_members_v2
     WHERE job_name=p_job_name AND outcome='PENDING' AND attempts<3 ORDER BY raw_row_id LIMIT p_limit)
    UNION ALL
    (SELECT raw_row_id FROM wf_canonical_staging.normalization_job_members_v2
     WHERE job_name=p_job_name AND outcome='LEASED' AND attempts<3 AND lease_expires_at<=clock_timestamp()
     ORDER BY raw_row_id LIMIT p_limit)
   ) candidate ON candidate.raw_row_id=m.raw_row_id
   WHERE m.job_name=p_job_name
   ORDER BY m.raw_row_id LIMIT p_limit FOR UPDATE OF m
  ) UPDATE wf_canonical_staging.normalization_job_members_v2 m
  SET outcome='LEASED',attempts=attempts+1,lease_id=p_lease_id,lease_expires_at=clock_timestamp()+interval '120 seconds'
  FROM pending p WHERE m.job_name=p_job_name AND m.raw_row_id=p.raw_row_id;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('raw_row_id',m.raw_row_id,'expected_source_hash',m.source_hash,
  'lease_expires_at',m.lease_expires_at,'raw',to_jsonb(r)||CASE WHEN job.immutable_snapshot_sha256 IS NOT NULL THEN jsonb_build_object('source_created_on',NULL,'captured_at',coalesce(job.capture_checkpoint->'started_at',to_jsonb(r.captured_at))) ELSE '{}'::jsonb END) ORDER BY m.raw_row_id),'[]'::jsonb) INTO result
 FROM wf_canonical_staging.normalization_job_members_v2 m JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id
 WHERE m.job_name=p_job_name AND m.lease_id=p_lease_id AND m.outcome='LEASED' AND m.lease_expires_at>clock_timestamp();
 RETURN result;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
