-- Reviewed literal WTB recovery supplements original proposals and frozen jobs.
-- Installation alone changes no raw evidence, proposals, members or publication.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.reviewed_literal_intent_recoveries_v2 (
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,original_proposal_hash text NOT NULL,
 recovery_hash text NOT NULL UNIQUE CHECK(recovery_hash ~ '^[a-f0-9]{64}$'),
 evidence_document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(raw_row_id,source_hash,original_proposal_hash),
 CHECK(encode(sha256(convert_to(evidence_document::text,'UTF8')),'hex')=recovery_hash)
);
ALTER TABLE wf_canonical_staging.reviewed_literal_intent_recoveries_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_literal_intent_recoveries_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(p_raw_id uuid,p_original_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $resolve$
DECLARE entry wf_canonical_staging.reviewed_literal_intent_recoveries_v2;
 raw wf_canonical_staging.mariadb_raw_source_rows;prior wf_canonical_staging.mariadb_normalized_proposals;
 evidence jsonb;original jsonb;approved jsonb;expected jsonb;proof jsonb;rules jsonb='[]';
 source_text text;derived text;reference text;attached text;source_rules jsonb;canonical text;
BEGIN
 SELECT * INTO entry FROM wf_canonical_staging.reviewed_literal_intent_recoveries_v2
 WHERE raw_row_id=p_raw_id AND original_proposal_hash=p_original_hash;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO STRICT raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.mariadb_normalized_proposals
 WHERE(source_system,source_database,source_table,source_id,source_hash)
 =(raw.source_system,raw.source_database,raw.source_table,raw.source_id,raw.source_hash);
 evidence=entry.evidence_document;original=prior.proposal_document;
 canonical=evidence->>'approved_proposal_canonical_json';approved=canonical::jsonb;
 source_text=original->>'listing_text_evidence';reference=approved->>'reference';source_rules=evidence->'intent_parsing_evidence';
 IF evidence->>'contract' IS DISTINCT FROM 'WF_REVIEWED_LITERAL_INTENT_RECOVERY_V1'
  OR evidence->>'raw_row_id' IS DISTINCT FROM raw.id::text OR evidence->>'source_hash' IS DISTINCT FROM raw.source_hash
  OR entry.source_hash IS DISTINCT FROM raw.source_hash OR evidence->>'original_proposal_hash' IS DISTINCT FROM prior.proposal_hash
  OR prior.proposal_hash IS DISTINCT FROM p_original_hash
  OR encode(sha256(convert_to(raw.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM raw.source_hash
  OR raw.raw_payload_text::jsonb IS DISTINCT FROM raw.raw_payload OR raw.raw_payload ? '_lossless_raw_evidence'
  OR encode(sha256(convert_to(prior.proposal_canonical_json,'UTF8')),'hex') IS DISTINCT FROM prior.proposal_hash
  OR prior.proposal_canonical_json::jsonb IS DISTINCT FROM original
  OR encode(sha256(convert_to(evidence::text,'UTF8')),'hex') IS DISTINCT FROM entry.recovery_hash
  OR encode(sha256(convert_to(canonical,'UTF8')),'hex') IS DISTINCT FROM evidence->>'approved_proposal_hash'
  OR coalesce(evidence->>'review_manifest_sha256','') !~ '^[a-f0-9]{64}$'
  OR original->>'parser_version' IS DISTINCT FROM 'authoritative-normalizer-v11-category-bound'
  OR original->>'intent' IS NOT NULL OR original->>'trading_floor_status' IS DISTINCT FROM 'HELD_INTENT_UNKNOWN'
  OR original->'is_bundle' IS DISTINCT FROM 'false'::jsonb
  OR source_text IS NULL OR original->>'listing_text_source' NOT IN('description','title','comments')
  OR source_text IS DISTINCT FROM btrim(raw.raw_payload->>(original->>'listing_text_source'),chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
  OR source_rules->>'source_text_sha256' IS DISTINCT FROM original->>'listing_text_sha256'
  OR encode(sha256(convert_to(source_text,'UTF8')),'hex') IS DISTINCT FROM original->>'listing_text_sha256' THEN
  RAISE EXCEPTION 'literal_recovery_evidence_changed' USING ERRCODE='22023';
 END IF;
 -- Only the intent-derived status fields may change. Identity, prices, media,
 -- source timestamps and every other canonical field remain exactly original.
 expected=original||jsonb_build_object('intent','WTB','trading_floor_status','ELIGIBLE_WTB','trading_floor_eligible',true,
  'price_research_status','INELIGIBLE_NOT_WTS','price_research_eligible',false,
  'review_flags',(original->'review_flags')-'UNKNOWN_INTENT',
  'exclusion_reasons',((original->'exclusion_reasons')-'INTENT_UNKNOWN_HELD_FROM_PUBLICATION')||'"INTENT_NOT_WTS"'::jsonb,
  'reconciliation_category','NORMALIZED_PROPOSAL','parser_version','authoritative-normalizer-v12-literal-intent');
 IF approved IS DISTINCT FROM expected OR source_rules->>'intent' IS DISTINCT FROM 'WTB' THEN
  RAISE EXCEPTION 'literal_recovery_unapproved_field_change' USING ERRCODE='22023'; END IF;
 derived=translate(normalize(source_text,NFKC),chr(8203)||chr(8204)||chr(8205)||chr(65279),'');
 IF derived<>source_text THEN rules=rules||'"UNICODE_INTENT_FORMATTING"'::jsonb; END IF;
 IF derived ~* E'^[^[:alnum:]]*W[ \\t]+T[ \\t]+[BS]($|[[:space:]:;,!?-])' THEN
  derived=regexp_replace(derived,E'^([^[:alnum:]]*)W[ \\t]+T[ \\t]+([BS])($|[[:space:]:;,!?-])',E'\\1WT\\2\\3','i');
  rules=rules||'"ANCHORED_SPACED_INTENT_HEADER"'::jsonb;
 END IF;
 attached=source_rules->>'attached_reference';
 IF attached IS NOT NULL THEN
  IF attached IS DISTINCT FROM reference OR derived !~* '^[^[:alnum:]]*NTQ[0-9]' THEN
   RAISE EXCEPTION 'literal_recovery_attached_reference_invalid' USING ERRCODE='22023'; END IF;
  derived=regexp_replace(derived,'^([^[:alnum:]]*NTQ)([0-9])',E'\\1 \\2','i');
  rules=rules||'"ANCHORED_ATTACHED_NTQ_EXACT_REFERENCE"'::jsonb;
 END IF;
 IF rules='[]'::jsonb OR rules IS DISTINCT FROM source_rules->'rules'
  OR encode(sha256(convert_to(derived,'UTF8')),'hex') IS DISTINCT FROM source_rules->>'derived_text_sha256'
  OR derived !~* '(^|[^[:alnum:]])(WTB|NTQ)([^[:alnum:]]|$)|looking[[:space:]]+(for|to[[:space:]]+buy)'
  OR derived ~* '(^|[^[:alnum:]])(WTS|FS)([^[:alnum:]]|$)|for[[:space:]]+sale|want[[:space:]]+to[[:space:]]+sell|selling'
  OR NOT EXISTS(SELECT 1 FROM generate_series(1,greatest(length(derived)-length(reference)+1,0)) pos
   WHERE lower(substr(derived,pos,length(reference)))=lower(reference)
    AND(pos=1 OR substr(derived,pos-1,1) !~ '[[:alnum:]./-]')
    AND(pos+length(reference)>length(derived) OR substr(derived,pos+length(reference),1) !~ '[[:alnum:]./-]')) THEN
  RAISE EXCEPTION 'literal_recovery_source_transform_invalid' USING ERRCODE='22023'; END IF;
 proof=wf_canonical_staging.review_single_source_identity_v2(approved,raw.raw_payload->>(approved->>'listing_text_source'));
 IF proof->>'outcome' IS DISTINCT FROM 'ELIGIBLE' THEN
  RAISE EXCEPTION 'literal_recovery_source_identity_requires_review' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('proposal',approved,'recovery_hash',entry.recovery_hash,
  'approved_proposal_hash',evidence->>'approved_proposal_hash','identity_proof',proof||jsonb_build_object(
   'brand',approved->'brand','reference',approved->'reference','intent',approved->'intent','resolution_hash',NULL,
   'normalization_recovery_hash',entry.recovery_hash,'effective_proposal_hash',evidence->>'approved_proposal_hash'));
END $resolve$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.record_reviewed_literal_intent_recoveries_v2(p_documents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $record$
DECLARE d jsonb;h text;prior wf_canonical_staging.reviewed_literal_intent_recoveries_v2;proof jsonb;result jsonb='[]';
BEGIN
 IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 23
  OR (SELECT count(DISTINCT value->>'raw_row_id') FROM jsonb_array_elements(p_documents))<>jsonb_array_length(p_documents) THEN
  RAISE EXCEPTION 'literal_recovery_batch_invalid' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
  h=encode(sha256(convert_to(d::text,'UTF8')),'hex');
  INSERT INTO wf_canonical_staging.reviewed_literal_intent_recoveries_v2(raw_row_id,source_hash,original_proposal_hash,recovery_hash,evidence_document)
  VALUES((d->>'raw_row_id')::uuid,d->>'source_hash',d->>'original_proposal_hash',h,d) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT prior FROM wf_canonical_staging.reviewed_literal_intent_recoveries_v2
  WHERE raw_row_id=(d->>'raw_row_id')::uuid AND source_hash=d->>'source_hash' AND original_proposal_hash=d->>'original_proposal_hash';
  IF prior.recovery_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'literal_recovery_replay_changed' USING ERRCODE='22023'; END IF;
  proof=wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(prior.raw_row_id,prior.original_proposal_hash);
  result=result||jsonb_build_array(jsonb_build_object('raw_row_id',prior.raw_row_id,'recovery_hash',h,'approved_proposal_hash',proof->>'approved_proposal_hash'));
 END LOOP;
 RETURN result;
END $record$;
REVOKE ALL ON FUNCTION wf_canonical_staging.record_reviewed_literal_intent_recoveries_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.resolve_effective_single_source_identity_v2(p_raw_id uuid,p_original_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE recovery jsonb;
BEGIN
 recovery=wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(p_raw_id,p_original_hash);
 IF recovery IS NOT NULL THEN RETURN recovery->'identity_proof'; END IF;
 RETURN wf_canonical_staging.resolve_reviewed_source_identity_v2(p_raw_id,p_original_hash);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_effective_single_source_identity_v2(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text;needle text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)'::regprocedure),chr(13),'');
 needle='DECLARE identity_review jsonb;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_materializer_declaration_changed'; END IF;
 definition=replace(definition,needle,'DECLARE normalization_recovery jsonb; identity_review jsonb;');
 needle='  d=p.proposal_document;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_materializer_proposal_changed'; END IF;
 definition=replace(definition,needle,needle||E'\n  normalization_recovery=wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(r.id,p_proposal_hash);\n  IF normalization_recovery IS NOT NULL THEN d=normalization_recovery->''proposal''; END IF;');
 needle='OR d->>''parser_version'' IS DISTINCT FROM ''authoritative-normalizer-v11-category-bound''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_materializer_version_changed'; END IF;
 definition=replace(definition,needle,'OR (d->>''parser_version'' IS DISTINCT FROM ''authoritative-normalizer-v11-category-bound'' AND NOT(normalization_recovery IS NOT NULL AND d->>''parser_version''=''authoritative-normalizer-v12-literal-intent''))');
 needle='wf_canonical_staging.resolve_reviewed_source_identity_v2(r.id,p_proposal_hash)';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_materializer_identity_changed'; END IF;
 definition=replace(definition,needle,'wf_canonical_staging.resolve_effective_single_source_identity_v2(r.id,p_proposal_hash)');
 needle='materialization_hash=encode(extensions.digest(convert_to(evidence::text,''UTF8''),''sha256''),''hex'');';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_materializer_hash_changed'; END IF;
 definition=replace(definition,needle,E'IF normalization_recovery IS NOT NULL THEN evidence=evidence||jsonb_build_object(''normalization_recovery_hash'',normalization_recovery->>''recovery_hash'',''effective_proposal_hash'',normalization_recovery->>''approved_proposal_hash''); END IF;\n '||needle);
 EXECUTE definition;
 definition=replace(pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure),chr(13),'');
 needle='wf_canonical_staging.resolve_reviewed_source_identity_v2(r.id,v.proposal_hash)';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_publisher_identity_changed'; END IF;
 definition=replace(definition,needle,'wf_canonical_staging.resolve_effective_single_source_identity_v2(r.id,v.proposal_hash)');
 needle='AND v.evidence_document->>''identity_resolution_hash'' IS NOT DISTINCT FROM identity_check.proof->>''resolution_hash''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_publisher_proof_changed'; END IF;
 definition=replace(definition,needle,needle||E'\n    AND v.evidence_document->>''normalization_recovery_hash'' IS NOT DISTINCT FROM identity_check.proof->>''normalization_recovery_hash''\n    AND v.evidence_document->>''effective_proposal_hash'' IS NOT DISTINCT FROM identity_check.proof->>''effective_proposal_hash''\n    AND (identity_check.proof->>''normalization_recovery_hash'' IS NULL OR v.document->''intent'' IS NOT DISTINCT FROM identity_check.proof->''intent'')');
 EXECUTE definition;
 -- Title/comments source cards also need the exact effective materialization
 -- proof; historical REVIEW membership remains unchanged. Dealer/contact policy
 -- after this raw-content check is left intact.
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_v2_source_dealer(text)'::regprocedure),chr(13),'');
 needle='AND member.proposal_hash=material.proposal_hash AND member.outcome=''NORMALIZED''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_recovery_source_card_proof_changed'; END IF;
 definition=replace(definition,needle,$source_card$AND member.proposal_hash=material.proposal_hash AND (member.outcome='NORMALIZED'
     OR (member.outcome='REVIEW' AND EXISTS(
      SELECT 1 FROM wf_canonical_staging.reviewed_literal_intent_recoveries_v2 recovery
      WHERE recovery.raw_row_id=member.raw_row_id AND recovery.source_hash=member.source_hash
       AND recovery.original_proposal_hash=member.proposal_hash
       AND recovery.recovery_hash=material.evidence_document->>'normalization_recovery_hash'
       AND recovery.evidence_document->>'approved_proposal_hash'=material.evidence_document->>'effective_proposal_hash'
       AND wf_canonical_staging.resolve_reviewed_literal_intent_recovery_v2(member.raw_row_id,member.proposal_hash)->>'recovery_hash'=recovery.recovery_hash
     )))$source_card$);
 EXECUTE definition;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
