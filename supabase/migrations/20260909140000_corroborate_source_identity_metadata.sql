-- Legacy identity labels are claims. The original message must corroborate
-- metadata-only identity before a single becomes public. Raw/proposals stay intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.review_single_source_identity_v2(p jsonb,source_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE reasons jsonb='[]'; disposition text='ELIGIBLE'; model text=p->>'model';
 message_key text=regexp_replace(lower(coalesce(source_text,'')),'[^[:alnum:]]','','g');
 reference_key text=regexp_replace(lower(coalesce(p->>'reference','')),'[^[:alnum:]]','','g');
 brand_key text=regexp_replace(lower(coalesce(p->>'brand','')),'[^[:alnum:]]','','g');
 model_key text=regexp_replace(lower(coalesce(p->>'model','')),'[^[:alnum:]]','','g');
BEGIN
 IF message_key='' OR reference_key='' OR brand_key='' THEN
  disposition='REVIEW';reasons=reasons||'"SOURCE_IDENTITY_EVIDENCE_MISSING"'::jsonb;
 ELSIF reference_key=brand_key OR reference_key !~ '[0-9]' THEN
  disposition='REVIEW';reasons=reasons||'"REFERENCE_REQUIRES_VERIFICATION"'::jsonb;
 END IF;
 IF p->>'reference_source_evidence'='source_metadata_reference' AND position(reference_key in message_key)=0 THEN
  disposition='REVIEW';reasons=reasons||'"SOURCE_METADATA_REFERENCE_UNCORROBORATED"'::jsonb;
 END IF;
 IF p->>'brand_source_evidence'='source_metadata_brand' AND position(brand_key in message_key)=0 THEN
  disposition='REVIEW';reasons=reasons||'"SOURCE_METADATA_BRAND_UNCORROBORATED"'::jsonb;
 END IF;
 IF model IS NOT NULL AND (model_key='' OR (p->>'model_source_evidence'='source_metadata_model' AND position(model_key in message_key)=0)) THEN
  model=NULL;reasons=reasons||'"SOURCE_METADATA_MODEL_UNCORROBORATED"'::jsonb;
 END IF;
 RETURN jsonb_build_object('outcome',disposition,'model',model,'reasons',reasons);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.review_single_source_identity_v2(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE definition text; needle text=E' IF disposition=''ELIGIBLE'' THEN\n  source_text=r.raw_payload->>(d->>''listing_text_source'');';
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)'::regprocedure),chr(13),'');
 IF strpos(definition,needle)=0 OR strpos(definition,'DECLARE m wf_canonical_staging.normalization_job_members_v2;')=0 THEN
  RAISE EXCEPTION 'source_identity_materializer_definition_mismatch'; END IF;
 definition=replace(definition,'DECLARE m wf_canonical_staging.normalization_job_members_v2;','DECLARE identity_review jsonb; m wf_canonical_staging.normalization_job_members_v2;');
 definition=replace(definition,needle,E' IF disposition=''ELIGIBLE'' THEN\n  identity_review=wf_canonical_staging.review_single_source_identity_v2(d,r.raw_payload->>(d->>''listing_text_source''));\n  disposition=identity_review->>''outcome''; reasons=reasons||(identity_review->''reasons'');\n  d=jsonb_set(d,''{model}'',identity_review->''model'');\n END IF;\n'||needle);
 EXECUTE definition;
END $$;
DO $$
DECLARE definition text; needle text='  IF v.outcome<>''ELIGIBLE'' THEN held=held+1; CONTINUE; END IF;';
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure),chr(13),'');
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_identity_publisher_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,needle||E'\n  IF NOT EXISTS(\n   SELECT 1 FROM wf_canonical_staging.mariadb_normalized_proposals p\n   CROSS JOIN LATERAL (SELECT wf_canonical_staging.review_single_source_identity_v2(p.proposal_document,r.raw_payload->>(p.proposal_document->>''listing_text_source'')) proof) identity_check\n   WHERE (p.source_system,p.source_database,p.source_table,p.source_id,p.source_hash)=(r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash)\n    AND p.proposal_hash=v.proposal_hash AND identity_check.proof->>''outcome''=''ELIGIBLE''\n    AND v.document->''brand'' IS NOT DISTINCT FROM p.proposal_document->''brand''\n    AND v.document->''reference'' IS NOT DISTINCT FROM p.proposal_document->''reference''\n    AND v.document->''model'' IS NOT DISTINCT FROM identity_check.proof->''model''\n  ) THEN RAISE EXCEPTION ''publication_source_identity_requires_review'' USING ERRCODE=''22023''; END IF;');
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
