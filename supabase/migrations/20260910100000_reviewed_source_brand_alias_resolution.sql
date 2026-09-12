-- A reviewed literal manufacturer name may corroborate the existing brand.
-- No catalog/model-family inference, automatic release, or raw/proposal rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_reviewed_source_identity_v2(uuid,text)'::regprocedure),chr(13),'');
 needle=E' IF d->>''approved_outcome''=''ELIGIBLE'' THEN\n  -- A reviewer may select only';
 replacement=E' IF d ? ''brand_alias_proof'' THEN\n'
 ||E'  IF d->>''approved_outcome'' IS DISTINCT FROM ''ELIGIBLE''\n'
 ||E'   OR d->''brand_alias_proof''->>''contract'' IS DISTINCT FROM ''WF_LITERAL_SOURCE_BRAND_ALIAS_V1''\n'
 ||E'   OR d->''brand_alias_proof''->>''offset_unit'' IS DISTINCT FROM ''UNICODE_CODE_POINTS''\n'
 ||E'   OR coalesce(d->''brand_alias_proof''->>''start'','''') !~ ''^[0-9]{1,8}$''\n'
 ||E'   OR coalesce(d->''brand_alias_proof''->>''end'','''') !~ ''^[0-9]{1,8}$''\n'
 ||E'   OR lower(ref) IS DISTINCT FROM lower(p.proposal_document->>''reference'')\n'
 ||E'   OR NOT coalesce(proof->''reasons'' @> ''["SOURCE_METADATA_BRAND_UNCORROBORATED"]''::jsonb,false)\n'
 ||E'   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(proof->''reasons'') reason WHERE reason NOT IN(''SOURCE_METADATA_BRAND_UNCORROBORATED'',''SOURCE_METADATA_MODEL_UNCORROBORATED''))\n'
 ||E'   OR NOT coalesce((\n'
 ||E'    (d->''brand_alias_proof''->>''rule_id''=''ALANGE_LITERAL_NAME_V1''\n'
 ||E'     AND regexp_replace(translate(lower(p.proposal_document->>''brand''),''ö'',''o''),''[^a-z0-9]'','''',''g'')=''alangesohne''\n'
 ||E'     AND lower(d->''brand_alias_proof''->>''quote'') IN(''lange'',''a. lange & sohne'',''a lange & sohne''))\n'
 ||E'    OR (d->''brand_alias_proof''->>''rule_id''=''GLASHUETTE_LITERAL_NAME_V1''\n'
 ||E'     AND regexp_replace(translate(lower(p.proposal_document->>''brand''),''ü'',''u''),''[^a-z0-9]'','''',''g'')=''glashutteoriginal''\n'
 ||E'     AND lower(d->''brand_alias_proof''->>''quote'')=''glashutte original'')),false) THEN\n'
 ||E'   RAISE EXCEPTION ''reviewed_brand_alias_proof_invalid'' USING ERRCODE=''22023'';\n'
 ||E'  END IF;\n'
 ||E'  IF (d->''brand_alias_proof''->>''end'')::int-(d->''brand_alias_proof''->>''start'')::int IS DISTINCT FROM length(d->''brand_alias_proof''->>''quote'')\n'
 ||E'   OR substr(t,(d->''brand_alias_proof''->>''start'')::int+1,length(d->''brand_alias_proof''->>''quote'')) IS DISTINCT FROM d->''brand_alias_proof''->>''quote''\n'
 ||E'   OR ((d->''brand_alias_proof''->>''start'')::int>0 AND substr(t,(d->''brand_alias_proof''->>''start'')::int,1) ~ ''[[:alnum:]]'')\n'
 ||E'   OR substr(t,(d->''brand_alias_proof''->>''end'')::int+1,1) ~ ''[[:alnum:]]'' THEN\n'
 ||E'   RAISE EXCEPTION ''reviewed_brand_alias_quote_not_source_exact'' USING ERRCODE=''22023'';\n'
 ||E'  END IF;\n'
 ||E'  proof=proof||jsonb_build_object(''outcome'',''ELIGIBLE'',''reasons'',(proof->''reasons'')-''SOURCE_METADATA_BRAND_UNCORROBORATED'');\n'
 ||E' END IF;\n'
 ||needle;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'reviewed_brand_alias_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
