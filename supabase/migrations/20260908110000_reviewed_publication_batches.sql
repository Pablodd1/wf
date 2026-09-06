-- Owner-only publication, with exact before/after evidence and reversible batches.
-- Run through a direct database release connection with a reviewed timeout;
-- million-row snapshot preparation must not run inside a Vercel request.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.publication_batches_v2 (
 batch_key text PRIMARY KEY,
 request_hash text NOT NULL,
 state text NOT NULL CHECK(state IN('APPLIED','ROLLED_BACK')),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),rolled_back_at timestamptz
);
CREATE TABLE wf_canonical_staging.publication_batch_rows_v2 (
 batch_key text NOT NULL REFERENCES wf_canonical_staging.publication_batches_v2(batch_key),
 listing_id text NOT NULL,
 materialization_hash text NOT NULL REFERENCES wf_canonical_staging.materialized_single_versions_v2(materialization_hash),
 before_state jsonb,after_state jsonb NOT NULL,
 PRIMARY KEY(batch_key,listing_id)
);
ALTER TABLE wf_canonical_staging.publication_batches_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.publication_batch_rows_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.publication_batches_v2,wf_canonical_staging.publication_batch_rows_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX published_v2_source_identity ON wf_canonical_staging.mariadb_canary_published_listings_v2(source_id,source_hash);
CREATE FUNCTION wf_canonical_staging.apply_publication_records_v2(p_records jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE assignments text;
BEGIN
 SELECT string_agg(format('%I=EXCLUDED.%I',attname,attname),',' ORDER BY attnum) INTO assignments
 FROM pg_attribute WHERE attrelid='wf_canonical_staging.mariadb_canary_published_listings_v2'::regclass
  AND attnum>0 AND NOT attisdropped AND attname<>'listing_id';
 EXECUTE 'INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2 AS target '
  ||'SELECT (jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,value)).* '
  ||'FROM jsonb_array_elements($1) ON CONFLICT(listing_id) DO UPDATE SET '||assignments
  ||' WHERE to_jsonb(target) IS DISTINCT FROM to_jsonb(EXCLUDED)' USING p_records;
END; $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.apply_publication_records_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.publish_materialized_batch_v2(p_batch_key text,p_expected_revision bigint,p_hashes text[],p_disposable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE prior wf_canonical_staging.publication_batches_v2; v wf_canonical_staging.materialized_single_versions_v2;
 r wf_canonical_staging.mariadb_raw_source_rows; current_revision bigint; request_hash text; old_doc jsonb; new_doc jsonb;
 changes jsonb='[]'; delta jsonb='[]'; ids text[]='{}'; n integer; inserted integer=0; identical integer=0; changed integer=0;
 held integer=0; before_count bigint; after_count bigint; result jsonb; snapshot_tf uuid; snapshot_pr uuid;
BEGIN
 IF p_batch_key IS NULL OR p_batch_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_expected_revision IS NULL
  OR p_hashes IS NULL OR cardinality(p_hashes) NOT BETWEEN 1 AND 500 OR p_disposable IS NULL
  OR EXISTS(SELECT 1 FROM unnest(p_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
  OR cardinality(p_hashes)<>(SELECT count(DISTINCT h) FROM unnest(p_hashes) h) THEN
  RAISE EXCEPTION 'publication_request_invalid' USING ERRCODE='22023'; END IF;
 IF p_disposable AND to_regnamespace('wf_disposable_legacy') IS NULL THEN
  RAISE EXCEPTION 'disposable_publication_target_refused' USING ERRCODE='22023'; END IF;
 request_hash=encode(extensions.digest(convert_to(jsonb_build_object('expected_revision',p_expected_revision,
  'hashes',(SELECT jsonb_agg(h ORDER BY h) FROM unnest(p_hashes) h),'disposable',p_disposable)::text,'UTF8'),'sha256'),'hex');
 SELECT revision INTO STRICT current_revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.publication_batches_v2 WHERE batch_key=p_batch_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'publication_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('state',prior.state,'replayed',true);
 END IF;
 IF current_revision<>p_expected_revision THEN RAISE EXCEPTION 'publication_revision_changed' USING ERRCODE='40001'; END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.materialized_single_versions_v2 WHERE materialization_hash=ANY(p_hashes);
 IF n<>cardinality(p_hashes) THEN RAISE EXCEPTION 'publication_materialization_missing' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.materialized_single_versions_v2 WHERE materialization_hash=ANY(p_hashes)
  GROUP BY raw_row_id HAVING count(*)>1) THEN RAISE EXCEPTION 'publication_conflicting_member_versions' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO before_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
 FOR v IN SELECT * FROM wf_canonical_staging.materialized_single_versions_v2 WHERE materialization_hash=ANY(p_hashes) ORDER BY raw_row_id LOOP
  IF encode(extensions.digest(convert_to(v.evidence_document::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM v.materialization_hash
   OR v.evidence_document->'document' IS DISTINCT FROM coalesce(v.document,'null'::jsonb)
   OR v.evidence_document->>'outcome' IS DISTINCT FROM v.outcome THEN
   RAISE EXCEPTION 'publication_canonical_content_mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=v.raw_row_id FOR SHARE;
  IF (r.raw_payload->'synthetic_fixture'='true'::jsonb OR r.test_run_id LIKE '%SYNTHETIC%') AND NOT p_disposable THEN
   RAISE EXCEPTION 'production_synthetic_evidence_refused' USING ERRCODE='22023'; END IF;
  IF p_disposable AND r.raw_payload->'synthetic_fixture' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'disposable_real_evidence_refused' USING ERRCODE='22023'; END IF;
  IF v.outcome<>'ELIGIBLE' THEN held=held+1; CONTINUE; END IF;
  IF r.source_hash IS DISTINCT FROM v.source_hash OR r.raw_payload_text IS NULL
   OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
   OR encode(extensions.digest(convert_to(r.raw_payload_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM v.source_hash
   OR v.document->>'source_hash' IS DISTINCT FROM v.source_hash OR v.document->>'source_id' IS DISTINCT FROM r.source_id
   OR v.document->'is_bundle' IS DISTINCT FROM 'false'::jsonb OR v.document->>'parent_listing_id' IS NOT NULL
   OR v.document->>'child_index' IS NOT NULL OR v.document->>'intent' NOT IN('WTS','WTB')
   OR v.document->>'category' IS DISTINCT FROM 'WATCH' THEN
   RAISE EXCEPTION 'publication_source_or_single_boundary_changed' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows conflict WHERE conflict.source_system=r.source_system
   AND conflict.source_database=r.source_database AND conflict.source_table=r.source_table AND conflict.source_id=r.source_id AND conflict.source_hash<>r.source_hash) THEN
   RAISE EXCEPTION 'publication_source_versions_conflict' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE c.source_id=r.source_id
    AND (c.listing_id<>v.document->>'listing_id' OR c.source_hash<>r.source_hash)) THEN
   RAISE EXCEPTION 'publication_existing_source_identity_conflict' USING ERRCODE='22023'; END IF;
  new_doc=to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,v.document));
  SELECT to_jsonb(c) INTO old_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE c.listing_id=v.document->>'listing_id' FOR UPDATE;
  IF FOUND AND old_doc=new_doc THEN identical=identical+1; CONTINUE;
  ELSIF old_doc IS NULL THEN inserted=inserted+1; ELSE changed=changed+1; END IF;
  changes=changes||jsonb_build_array(new_doc);ids=array_append(ids,new_doc->>'listing_id');
  delta=delta||jsonb_build_array(jsonb_build_object('listing_id',new_doc->>'listing_id','materialization_hash',v.materialization_hash,'before_state',old_doc));
 END LOOP;
 IF jsonb_array_length(changes)>0 THEN
  PERFORM wf_canonical_staging.apply_publication_records_v2(changes);
  PERFORM public.reconcile_v2_listing_dealers(ids);
  -- Both immutable surfaces become visible with the same committed revision.
  snapshot_tf=public.open_trading_floor_keyset_snapshot(3600);
  snapshot_pr=public.open_price_research_keyset_snapshot(3600);
 END IF;
 SELECT count(*) INTO after_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
 SELECT revision INTO STRICT current_revision FROM wf_canonical_staging.publication_revision WHERE singleton;
 IF after_count<>before_count+inserted OR cardinality(p_hashes)<>inserted+identical+changed+held THEN
  RAISE EXCEPTION 'publication_counts_do_not_reconcile' USING ERRCODE='22023'; END IF;
 result=jsonb_build_object('batch_key',p_batch_key,'state','APPLIED','input',cardinality(p_hashes),'inserted',inserted,'identical',identical,
  'changed',changed,'held',held,'before_count',before_count,'after_count',after_count,'revision',current_revision,
  'trading_snapshot',snapshot_tf,'price_snapshot',snapshot_pr,'replayed',false);
 INSERT INTO wf_canonical_staging.publication_batches_v2(batch_key,request_hash,state,result) VALUES(p_batch_key,request_hash,'APPLIED',result);
 INSERT INTO wf_canonical_staging.publication_batch_rows_v2(batch_key,listing_id,materialization_hash,before_state,after_state)
 SELECT p_batch_key,item->>'listing_id',item->>'materialization_hash',nullif(item->'before_state','null'::jsonb),to_jsonb(c)
 FROM jsonb_array_elements(delta) item JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 c ON c.listing_id=item->>'listing_id';
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.publish_materialized_batch_v2(text,bigint,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.rollback_materialized_batch_v2(p_batch_key text,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE prior wf_canonical_staging.publication_batches_v2; current_revision bigint; records jsonb; ids text[]; result jsonb; deleted integer;
BEGIN
 SELECT revision INTO STRICT current_revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.publication_batches_v2 WHERE batch_key=p_batch_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rollback_batch_missing' USING ERRCODE='22023'; END IF;
 IF prior.state='ROLLED_BACK' THEN RETURN prior.result||jsonb_build_object('state','ROLLED_BACK','replayed',true); END IF;
 IF p_expected_revision IS NULL OR current_revision<>p_expected_revision THEN RAISE EXCEPTION 'rollback_revision_changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.publication_batch_rows_v2 b LEFT JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 c ON c.listing_id=b.listing_id
  WHERE b.batch_key=p_batch_key AND to_jsonb(c) IS DISTINCT FROM b.after_state) THEN
  RAISE EXCEPTION 'rollback_published_content_changed' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(before_state) FILTER(WHERE before_state IS NOT NULL),'[]'::jsonb),coalesce(array_agg(listing_id),'{}') INTO records,ids
 FROM wf_canonical_staging.publication_batch_rows_v2 WHERE batch_key=p_batch_key;
 IF jsonb_array_length(records)>0 THEN PERFORM wf_canonical_staging.apply_publication_records_v2(records); END IF;
 DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c USING wf_canonical_staging.publication_batch_rows_v2 b
 WHERE b.batch_key=p_batch_key AND b.before_state IS NULL AND c.listing_id=b.listing_id;
 GET DIAGNOSTICS deleted=ROW_COUNT;
 IF cardinality(ids)>0 THEN
  PERFORM public.reconcile_v2_listing_dealers(ids);
  PERFORM public.open_trading_floor_keyset_snapshot(3600);
  PERFORM public.open_price_research_keyset_snapshot(3600);
 END IF;
 SELECT revision INTO STRICT current_revision FROM wf_canonical_staging.publication_revision WHERE singleton;
 result=prior.result||jsonb_build_object('state','ROLLED_BACK','rollback_revision',current_revision,'removed_insertions',deleted,'restored_updates',jsonb_array_length(records));
 UPDATE wf_canonical_staging.publication_batches_v2 SET state='ROLLED_BACK',rolled_back_at=now(),result=result WHERE batch_key=p_batch_key;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.rollback_materialized_batch_v2(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
