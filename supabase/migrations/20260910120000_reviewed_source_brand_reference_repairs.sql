-- Reviewed source-exact repairs for legacy reference extraction, alongside a
-- literal manufacturer name. The original proposal and source remain immutable.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_reviewed_source_identity_v2(uuid,text)'::regprocedure),chr(13),'');
 needle=E'   OR lower(ref) IS DISTINCT FROM lower(p.proposal_document->>''reference'')\n';
 replacement=E'   OR (lower(ref) IS DISTINCT FROM lower(p.proposal_document->>''reference'') AND NOT d ? ''reference_repair_proof'')\n';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_reference_repair_alias_definition_mismatch'; END IF;
 definition=replace(definition,needle,replacement);
 needle=E'  proof=proof||jsonb_build_object(''outcome'',''ELIGIBLE'',''reasons'',(proof->''reasons'')-''SOURCE_METADATA_BRAND_UNCORROBORATED'');';
 replacement=E'  IF d ? ''reference_repair_proof'' THEN\n'
 ||E'   IF d->''reference_repair_proof''->>''contract'' IS DISTINCT FROM ''WF_LITERAL_SOURCE_REFERENCE_REPAIR_V1''\n'
 ||E'    OR d->''reference_repair_proof''->>''offset_unit'' IS DISTINCT FROM ''UNICODE_CODE_POINTS''\n'
 ||E'    OR coalesce(d->''reference_repair_proof''->>''start'','''') !~ ''^[0-9]{1,8}$''\n'
 ||E'    OR coalesce(d->''reference_repair_proof''->>''end'','''') !~ ''^[0-9]{1,8}$''\n'
 ||E'    OR lower(d->''reference_repair_proof''->>''quote'') IS DISTINCT FROM lower(ref)\n'
 ||E'    OR NOT coalesce((\n'
 ||E'     (d->''reference_repair_proof''->>''rule_id''=''INTENT_PREFIX_INCLUDED_IN_REFERENCE'' AND lower(p.proposal_document->>''reference'')=''ntq ''||lower(ref))\n'
 ||E'     OR (d->''reference_repair_proof''->>''rule_id''=''MODEL_FAMILY_1815_USED_AS_REFERENCE'' AND p.proposal_document->>''reference''=''1815'' AND ref ~ ''^[0-9]{3}[.][0-9]{3}[A-Za-z]{0,3}$'')\n'
 ||E'     OR (d->''reference_repair_proof''->>''rule_id''=''SENTENCE_PERIOD_INCLUDED_IN_REFERENCE'' AND lower(p.proposal_document->>''reference'')=lower(ref)||''.'')\n'
 ||E'     OR (d->''reference_repair_proof''->>''rule_id''=''LEADING_REFERENCE_COMPONENT_TRUNCATED'' AND ref ~ ''^[0-9]{3}[.][0-9]{3}[A-Za-z]{0,3}$'' AND lower(right(ref,length(p.proposal_document->>''reference'')+1))=''.''||lower(p.proposal_document->>''reference''))\n'
 ||E'     OR (d->''reference_repair_proof''->>''rule_id''=''EXPLICIT_REFERENCE_SUFFIX_OMITTED'' AND lower(ref)=lower(p.proposal_document->>''reference'')||'' e'')),false) THEN\n'
 ||E'    RAISE EXCEPTION ''reviewed_reference_repair_proof_invalid'' USING ERRCODE=''22023'';\n'
 ||E'   END IF;\n'
 ||E'   IF (d->''reference_repair_proof''->>''end'')::int-(d->''reference_repair_proof''->>''start'')::int IS DISTINCT FROM length(d->''reference_repair_proof''->>''quote'')\n'
 ||E'    OR substr(t,(d->''reference_repair_proof''->>''start'')::int+1,length(d->''reference_repair_proof''->>''quote'')) IS DISTINCT FROM d->''reference_repair_proof''->>''quote''\n'
 ||E'    OR ((d->''reference_repair_proof''->>''start'')::int>0 AND substr(t,(d->''reference_repair_proof''->>''start'')::int,1) ~ ''[[:alnum:]]'')\n'
 ||E'    OR substr(t,(d->''reference_repair_proof''->>''end'')::int+1,1) ~ ''[[:alnum:]]'' THEN\n'
 ||E'    RAISE EXCEPTION ''reviewed_reference_repair_quote_not_source_exact'' USING ERRCODE=''22023'';\n'
 ||E'   END IF;\n'
 ||E'  END IF;\n'
 ||needle;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_reference_repair_proof_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
