BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.materialization_image_outcome_v2(p_normalization_job text,p_raw_id uuid,p_outcome text,p_image_hash text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE raw wf_canonical_staging.mariadb_raw_source_rows;normalized_outcome text;verified boolean;image_value jsonb;
BEGIN
 SELECT m.outcome INTO STRICT normalized_outcome FROM wf_canonical_staging.normalization_job_members_v2 m WHERE m.job_name=p_normalization_job AND m.raw_row_id=p_raw_id;
 IF normalized_outcome<>'NORMALIZED' THEN
  IF p_image_hash IS NOT NULL THEN RAISE EXCEPTION 'held_materialization_image_not_applicable' USING ERRCODE='22023'; END IF;
  RETURN 'NOT_APPLICABLE';
 END IF;
 IF p_outcome='QUARANTINE' THEN RETURN 'SOURCE_PROVENANCE_REQUIRES_REVIEW'; END IF;
 SELECT * INTO STRICT raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 IF p_image_hash IS NOT NULL THEN
  SELECT i.verified INTO verified FROM wf_canonical_staging.source_image_evidence_v2 i WHERE i.evidence_hash=p_image_hash AND i.raw_row_id=p_raw_id AND i.source_hash=raw.source_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'materialization_image_receipt_mismatch' USING ERRCODE='22023'; END IF;
  RETURN CASE WHEN verified THEN 'VERIFIED_SOURCE_IMAGE' ELSE 'SOURCE_IMAGE_UNAVAILABLE' END;
 END IF;
 image_value=coalesce(nullif(nullif(raw.raw_payload->'front_image','null'::jsonb),'""'::jsonb),nullif(raw.raw_payload->'image','null'::jsonb));
 IF image_value IS NULL OR image_value='""'::jsonb THEN RETURN 'NO_SOURCE_IMAGE'; END IF;
 IF jsonb_typeof(image_value)<>'string' OR wf_canonical_staging.source_image_candidate_v2(image_value#>>'{}') IS NULL THEN RETURN 'SOURCE_IMAGE_KEY_REQUIRES_REVIEW'; END IF;
 RAISE EXCEPTION 'materialization_source_image_probe_required' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.materialization_image_outcome_v2(text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE definition text;needle text='v_result->>''outcome'',item->>''image_probe_outcome'',item->>''image_evidence_hash''';
BEGIN
 definition=pg_get_functiondef('public.commit_materialization_workflow_batch_v2(text,uuid,uuid,jsonb)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'materialization_completion_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,'v_result->>''outcome'',wf_canonical_staging.materialization_image_outcome_v2(j.normalization_job_name,(item->>''raw_row_id'')::uuid,v_result->>''outcome'',item->>''image_evidence_hash''),item->>''image_evidence_hash''');
END $$;
COMMIT;
