-- Source created_on is mutable. Reused raw versions must not turn it into a posting date.
-- Project only normalization inputs; preserve every stored raw field unchanged.
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
   SELECT raw_row_id FROM wf_canonical_staging.normalization_job_members_v2
   WHERE job_name=p_job_name AND attempts<3 AND (outcome='PENDING' OR (outcome='LEASED' AND lease_expires_at<=clock_timestamp()))
   ORDER BY raw_row_id LIMIT p_limit FOR UPDATE
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
CREATE OR REPLACE FUNCTION public.complete_normalization_batch_v2(p_job_name text,p_lease_id uuid,p_results jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job wf_canonical_staging.normalization_jobs_v2; item jsonb; member wf_canonical_staging.normalization_job_members_v2; raw wf_canonical_staging.mariadb_raw_source_rows;
 doc jsonb; proposals jsonb:='[]'::jsonb; stored jsonb; digest text; result jsonb; n integer;
 norm integer:=0; review integer:=0; bundles integer:=0; quarantine integer:=0; errors integer:=0; tf integer:=0; pr integer:=0; disposition text;
BEGIN
 IF p_lease_id IS NULL OR jsonb_typeof(p_results) IS DISTINCT FROM 'array' OR jsonb_array_length(p_results) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'invalid_normalization_results' USING ERRCODE='22023'; END IF;
 digest=encode(extensions.digest(convert_to(p_results::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO job FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name=p_job_name FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'normalization_job_not_found' USING ERRCODE='22023'; END IF;
 SELECT to_jsonb(b) INTO stored FROM wf_canonical_staging.normalization_job_batches_v2 b WHERE lease_id=p_lease_id;
 IF FOUND THEN
  IF stored->>'job_name' IS DISTINCT FROM p_job_name OR stored->>'result_hash' IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'normalization_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN stored->'result';
 END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.normalization_job_members_v2
 WHERE job_name=p_job_name AND lease_id=p_lease_id AND outcome='LEASED' AND lease_expires_at>clock_timestamp();
 IF n<>jsonb_array_length(p_results) OR n<>(SELECT count(DISTINCT value->>'raw_row_id') FROM jsonb_array_elements(p_results)) THEN
  RAISE EXCEPTION 'normalization_lease_membership_mismatch' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
  SELECT * INTO member FROM wf_canonical_staging.normalization_job_members_v2
  WHERE job_name=p_job_name AND raw_row_id=(item->>'raw_row_id')::uuid AND lease_id=p_lease_id AND outcome='LEASED';
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization_lease_membership_mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=member.raw_row_id;
  IF raw.source_hash IS DISTINCT FROM member.source_hash THEN RAISE EXCEPTION 'frozen_raw_identity_changed' USING ERRCODE='22023'; END IF;
  doc=item->'proposal';
  IF doc IS NOT NULL AND doc<>'null'::jsonb THEN
   IF job.immutable_snapshot_sha256 IS NOT NULL AND (
    doc->>'posted_at' IS NOT NULL OR (job.capture_checkpoint->>'started_at' IS NOT NULL
     AND (doc->>'source_observed_at')::timestamptz IS DISTINCT FROM (job.capture_checkpoint->>'started_at')::timestamptz)
   ) THEN RAISE EXCEPTION 'snapshot_observation_time_mismatch' USING ERRCODE='22023'; END IF;
   IF (doc->>'source_system',doc->>'source_database',doc->>'source_table',doc->>'source_id',doc->>'source_hash',doc->>'source_record_id')
     IS DISTINCT FROM (raw.source_system,raw.source_database,raw.source_table,raw.source_id,raw.source_hash,raw.source_record_id) THEN
    RAISE EXCEPTION 'normalization_proposal_identity_mismatch' USING ERRCODE='22023'; END IF;
   proposals=proposals||jsonb_build_array(doc);
   IF (doc->>'is_bundle')::boolean IS TRUE THEN disposition='BUNDLE_HELD';bundles=bundles+1;
   ELSIF (doc->>'trading_floor_eligible')::boolean IS TRUE THEN disposition='NORMALIZED';norm=norm+1;
   ELSE disposition='REVIEW';review=review+1; END IF;
   IF disposition='NORMALIZED' THEN
    tf=tf+1; IF (doc->>'price_research_eligible')::boolean IS TRUE THEN pr=pr+1; END IF;
   END IF;
  ELSE
   IF item->>'outcome' NOT IN ('QUARANTINE','ERROR') OR item->>'outcome' IS NULL
    OR item->>'error_code' IS NULL OR item->>'error_code' !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN
    RAISE EXCEPTION 'invalid_normalization_error_outcome' USING ERRCODE='22023'; END IF;
   disposition=item->>'outcome';
   IF disposition='QUARANTINE' THEN quarantine=quarantine+1; ELSE errors=errors+1; END IF;
  END IF;
  UPDATE wf_canonical_staging.normalization_job_members_v2 SET outcome=disposition,proposal_hash=doc->>'proposal_hash',
   error_code=CASE WHEN disposition IN ('QUARANTINE','ERROR') THEN item->>'error_code' END,completed_at=now(),lease_expires_at=NULL
  WHERE job_name=p_job_name AND raw_row_id=member.raw_row_id;
 END LOOP;
 -- Source validation, proposal persistence, outcomes and checkpoint are atomic.
 IF jsonb_array_length(proposals)>0 THEN PERFORM public.upsert_mariadb_normalized_proposals_batch(proposals); END IF;
 UPDATE wf_canonical_staging.normalization_jobs_v2 SET processed_rows=processed_rows+n,normalized_rows=normalized_rows+norm,
  review_rows=review_rows+review,bundle_rows=bundle_rows+bundles,quarantine_rows=quarantine_rows+quarantine,error_rows=error_rows+errors,
  trading_floor_eligible_rows=trading_floor_eligible_rows+tf,price_research_eligible_rows=price_research_eligible_rows+pr,updated_at=now()
 WHERE job_name=p_job_name RETURNING to_jsonb(normalization_jobs_v2) INTO result;
 INSERT INTO wf_canonical_staging.normalization_job_batches_v2(lease_id,job_name,result_hash,result) VALUES(p_lease_id,p_job_name,digest,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_normalization_batch_v2(text,uuid,integer),public.complete_normalization_batch_v2(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_normalization_batch_v2(text,uuid,integer),public.complete_normalization_batch_v2(text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
