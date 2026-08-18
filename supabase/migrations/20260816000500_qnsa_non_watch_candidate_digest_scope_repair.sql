-- Forward repair for candidate-page digest scope.
--
-- A CTE exists for one SQL statement only. The installed function attempted to
-- read candidate_page again in its later RETURN statement. Capture the digest
-- during the existing CTE SELECT INTO and return only the scalar variable.

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $repair$
DECLARE
  v_definition text;
  v_old_declaration constant text := $old_declaration$
  v_matched_phones text[] := ARRAY[]::text[];
$old_declaration$;
  v_new_declaration constant text := $new_declaration$
  v_matched_phones text[] := ARRAY[]::text[];
  v_candidate_page_digest text := md5('');
$new_declaration$;
  v_old_select constant text := $old_select$
    (SELECT count(*)>v_limit FROM candidates),
    count(DISTINCT eligible.dealer_id)
  INTO v_listing_ids,v_source_record_ids,v_dealer_ids,v_matched_phones,
    v_scanned,v_next_created_at,v_next_id,v_has_more,v_dealers_matched
$old_select$;
  v_new_select constant text := $new_select$
    (SELECT count(*)>v_limit FROM candidates),
    (SELECT COALESCE(md5(string_agg(
      concat_ws(':',id::text,created_at::text,raw_message_version_id::text,
        source_record_id,source_hash,source_candidate_hash),','
      ORDER BY created_at DESC,id DESC)),md5('')) FROM candidate_page),
    count(DISTINCT eligible.dealer_id)
  INTO v_listing_ids,v_source_record_ids,v_dealer_ids,v_matched_phones,
    v_scanned,v_next_created_at,v_next_id,v_has_more,v_candidate_page_digest,v_dealers_matched
$new_select$;
  v_old_return constant text := $old_return$
    'candidate_page_digest',COALESCE((SELECT md5(string_agg(
      concat_ws(':',id::text,created_at::text,raw_message_version_id::text,
        source_record_id,source_hash,source_candidate_hash),','
      ORDER BY created_at DESC,id DESC)) FROM candidate_page),md5('')),
$old_return$;
  v_new_return constant text := $new_return$
    'candidate_page_digest',v_candidate_page_digest,
$new_return$;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(
    'public.qnsa_non_watch_dealer_candidate_link_page(text,text,timestamptz,uuid,timestamptz,uuid,integer,boolean,integer)'
  )) INTO v_definition;
  IF v_definition IS NULL THEN RAISE EXCEPTION 'candidate-driven linkage function is unavailable'; END IF;

  IF position(v_old_declaration in v_definition)>0 THEN
    v_definition:=replace(v_definition,v_old_declaration,v_new_declaration);
  ELSIF position(v_new_declaration in v_definition)=0 THEN
    RAISE EXCEPTION 'candidate digest declaration does not match reviewed contract';
  END IF;
  IF position(v_old_select in v_definition)>0 THEN
    v_definition:=replace(v_definition,v_old_select,v_new_select);
  ELSIF position(v_new_select in v_definition)=0 THEN
    RAISE EXCEPTION 'candidate digest SELECT INTO does not match reviewed contract';
  END IF;
  IF position(v_old_return in v_definition)>0 THEN
    v_definition:=replace(v_definition,v_old_return,v_new_return);
  ELSIF position(v_new_return in v_definition)=0 THEN
    RAISE EXCEPTION 'candidate digest return does not match reviewed contract';
  END IF;

  IF position('FROM candidate_page' in substring(v_definition
      from position('RETURN jsonb_build_object' in v_definition)))>0 THEN
    RAISE EXCEPTION 'candidate-page CTE escapes its SQL statement';
  END IF;
  EXECUTE v_definition;
END
$repair$;

COMMIT;
