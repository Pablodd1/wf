-- Owner-approved buyer inquiries are separate from dealer reputation verification.
-- Only the reviewed exact-source importer may create these private attestations.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.is_approved_source_poster_v2(p_status text,p_metadata jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(p_status='UNVERIFIED'
  AND p_metadata->>'contract'='WF_COMPLETE_SOURCE_POSTER_IDENTITY_V1'
  AND p_metadata->>'source_identity_evidence'='EXACT_COMPANY_PHONE_MATCH'
  AND p_metadata->>'dealer_verification_inferred'='false'
  AND p_metadata->>'company_snapshot_sha256' ~ '^[a-f0-9]{64}$'
  AND p_metadata->'contact_permission_evidence'->>'contract'='WF_OWNER_ATTESTED_POSTER_CONTACT_PERMISSION_V1'
  AND p_metadata->'contact_permission_evidence'->>'approval_source'='COMPANY_OWNER_ATTESTATION_OF_EXPLICIT_POSTER_PERMISSION'
  AND p_metadata->'contact_permission_evidence'->>'sha256' ~ '^[a-f0-9]{64}$',false)
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.is_approved_source_poster_v2(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION wf_canonical_staging.is_approved_source_poster_v2(text,jsonb) TO service_role;

DO $migration$
DECLARE definition text; signature text; needle text; replacement text;
BEGIN
 signature='wf_canonical_staging.resolve_v2_source_dealer(text)';
 definition=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 needle='d.status=''VERIFIED''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_resolver_definition_mismatch'; END IF;
 definition=replace(definition,needle,'(d.status=''VERIFIED'' OR wf_canonical_staging.is_approved_source_poster_v2(d.status,d.metadata))');
 needle='i.source_system<>''WF_VERIFIED_SOURCE_COMPANY_V1''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_identity_definition_mismatch'; END IF;
 definition=replace(definition,needle,'i.source_system NOT IN (''WF_VERIFIED_SOURCE_COMPANY_V1'',''WF_SOURCE_POSTER_V1'')');
 definition=replace(definition,'i.metadata->>''contract''=''WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1''',
  'i.metadata->>''contract'' IN (''WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1'',''WF_COMPLETE_SOURCE_POSTER_IDENTITY_V1'')');
 EXECUTE definition;

 definition=pg_get_viewdef('wf_canonical_staging.v2_approved_listing_dealers'::regclass,true);
 needle='d.status = ''VERIFIED''::text';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_view_definition_mismatch'; END IF;
 definition=replace(definition,needle,'(d.status = ''VERIFIED''::text OR wf_canonical_staging.is_approved_source_poster_v2(d.status,d.metadata))');
 EXECUTE 'CREATE OR REPLACE VIEW wf_canonical_staging.v2_approved_listing_dealers WITH(security_invoker=true) AS '||definition;

 definition=replace(pg_get_functiondef('public.get_v2_listing_contact(text,text)'::regprocedure),chr(13),'');
 needle='SELECT * INTO d FROM public.dealers WHERE id=(proof->>''dealer_id'')::uuid AND status=''VERIFIED'';';
 replacement='SELECT * INTO d FROM public.dealers WHERE id=(proof->>''dealer_id'')::uuid AND (status=''VERIFIED'' OR wf_canonical_staging.is_approved_source_poster_v2(status,metadata));';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_contact_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);

 definition=replace(pg_get_functiondef('public.get_approved_dealer_profile(text)'::regprocedure),chr(13),'');
 needle='dealer.status=''VERIFIED''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_profile_definition_mismatch'; END IF;
 definition=replace(definition,needle,'(dealer.status=''VERIFIED'' OR wf_canonical_staging.is_approved_source_poster_v2(dealer.status,dealer.metadata))');
 definition=replace(definition,'''source_system'',''WATCHFACTS_VERIFIED_DEALERS''',
  '''source_system'',CASE WHEN d.status=''VERIFIED'' THEN ''WATCHFACTS_VERIFIED_DEALERS'' ELSE ''WATCHFACTS_SOURCE_POSTERS'' END');
 EXECUTE definition;

 definition=replace(pg_get_functiondef('public.get_approved_dealer_directory(text,boolean,integer,integer)'::regprocedure),chr(13),'');
 needle='d.status=''VERIFIED''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'source_poster_directory_definition_mismatch'; END IF;
 definition=replace(definition,needle,'(d.status=''VERIFIED'' OR wf_canonical_staging.is_approved_source_poster_v2(d.status,d.metadata))');
 definition=replace(definition,'''source_system'',''WATCHFACTS_VERIFIED_DEALERS''',
  '''source_system'',CASE WHEN status=''VERIFIED'' THEN ''WATCHFACTS_VERIFIED_DEALERS'' ELSE ''WATCHFACTS_SOURCE_POSTERS'' END');
 EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
