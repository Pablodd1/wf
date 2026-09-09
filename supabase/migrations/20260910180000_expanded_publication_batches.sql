-- Publish only exact private versions. Cohorts retain beforeimages and must
-- prepare both public snapshots before their transaction can commit.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.expanded_publication_registry_v3 (
 listing_id text PRIMARY KEY REFERENCES wf_canonical_staging.mariadb_canary_published_listings_v2(listing_id),
 materialization_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_listing_versions_v3(materialization_hash)
);
CREATE TABLE wf_canonical_staging.expanded_publication_batches_v3 (
 batch_key text PRIMARY KEY, request_hash text NOT NULL, transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
 state text NOT NULL CHECK(state IN('APPLIED','ROLLED_BACK')), result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wf_canonical_staging.expanded_publication_batch_rows_v3 (
 batch_key text NOT NULL REFERENCES wf_canonical_staging.expanded_publication_batches_v3(batch_key),
 listing_id text NOT NULL, materialization_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_listing_versions_v3(materialization_hash),
 source_id text NOT NULL, before_state jsonb, after_state_hash text NOT NULL, before_registry_hash text,
 before_lineage jsonb, after_lineage_hash text NOT NULL,
 PRIMARY KEY(batch_key,listing_id)
);
CREATE TABLE wf_canonical_staging.expanded_publication_cohorts_v3 (
 cohort_key text PRIMARY KEY,transaction_id xid8 NOT NULL UNIQUE,batch_keys text[] NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expanded_batches_transaction_v3 ON wf_canonical_staging.expanded_publication_batches_v3(transaction_id);
ALTER TABLE wf_canonical_staging.expanded_publication_registry_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.expanded_publication_batches_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.expanded_publication_batch_rows_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.expanded_publication_cohorts_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.expanded_publication_registry_v3,wf_canonical_staging.expanded_publication_batches_v3,
 wf_canonical_staging.expanded_publication_batch_rows_v3,wf_canonical_staging.expanded_publication_cohorts_v3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.publish_expanded_batch_v3(p_key text,p_revision bigint,p_hashes text[],p_disposable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior wf_canonical_staging.expanded_publication_batches_v3; v wf_canonical_staging.expanded_listing_versions_v3;
 r wf_canonical_staging.mariadb_raw_source_rows; c wf_canonical_staging.expanded_listing_candidates_v3;
 revision bigint; request_hash text; old_doc jsonb; old_registry text; old_lineage jsonb; delta jsonb='[]';docs jsonb='[]';ids text[]='{}';
 n integer; inserted integer=0; identical integer=0; result jsonb;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_revision IS NULL OR p_disposable IS NULL
  OR p_hashes IS NULL OR cardinality(p_hashes) NOT BETWEEN 1 AND 500
  OR cardinality(p_hashes)<>(SELECT count(DISTINCT h) FROM unnest(p_hashes) h) THEN RAISE EXCEPTION 'expanded_batch_request_invalid' USING ERRCODE='22023'; END IF;
 request_hash=encode(sha256(convert_to(jsonb_build_array(p_revision,p_hashes,p_disposable)::text,'UTF8')),'hex');
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE batch_key=p_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'expanded_batch_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'state',prior.state);
 END IF;
 IF revision<>p_revision THEN RAISE EXCEPTION 'expanded_publication_revision_changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 SELECT count(*) INTO n FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes);
 IF n<>cardinality(p_hashes) OR EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes) GROUP BY listing_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'expanded_batch_versions_invalid' USING ERRCODE='22023'; END IF;
 FOR v IN SELECT * FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=ANY(p_hashes) ORDER BY listing_id LOOP
  SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=v.raw_row_id;
  IF (p_disposable AND (to_regnamespace('wf_disposable_legacy') IS NULL OR r.raw_payload->'synthetic_fixture' IS DISTINCT FROM 'true'::jsonb))
   OR (NOT p_disposable AND (r.raw_payload->'synthetic_fixture'='true'::jsonb OR r.source_system LIKE 'SYNTHETIC%')) THEN
   RAISE EXCEPTION 'expanded_disposable_source_boundary_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=v.candidate_hash;
  PERFORM wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);
  IF v.source_hash IS DISTINCT FROM r.source_hash OR v.raw_row_id<>c.raw_row_id
   OR encode(sha256(convert_to(jsonb_build_array(v.candidate_hash,v.document,v.fx_evidence_hash,v.image_evidence_hash)::text,'UTF8')),'hex') IS DISTINCT FROM v.materialization_hash
   OR v.document->>'source_id' IS DISTINCT FROM r.source_id OR v.document->>'source_hash' IS DISTINCT FROM r.source_hash
   OR v.document->>'listing_id' IS DISTINCT FROM v.listing_id THEN RAISE EXCEPTION 'expanded_version_content_invalid' USING ERRCODE='22023'; END IF;
  -- Verify the materializer produces the same source-bound values, including FX.
  IF wf_canonical_staging.materialize_expanded_candidate_v3(v.candidate_hash,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM v.materialization_hash THEN
   RAISE EXCEPTION 'expanded_materialization_rebuild_changed' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(x) INTO old_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE x.listing_id=v.listing_id FOR UPDATE;
  SELECT materialization_hash INTO old_registry FROM wf_canonical_staging.expanded_publication_registry_v3 WHERE listing_id=v.listing_id;
  SELECT to_jsonb(l) INTO old_lineage FROM public.seller_listing_lineage_staging l
   WHERE l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=v.listing_id AND l.seller_listing_id=v.document->>'source_id' FOR UPDATE;
  IF old_doc IS NOT NULL THEN
   IF old_doc=v.document AND old_registry=v.materialization_hash THEN identical=identical+1;CONTINUE; END IF;
   -- Existing reviewed singles and changed source versions need a separate,
   -- explicitly evidenced correction; this additive batch never overwrites them.
   RAISE EXCEPTION 'expanded_existing_listing_requires_version_review' USING ERRCODE='22023';
  END IF;
  IF c.kind='CHILD' AND EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE x.listing_id=v.document->>'parent_listing_id') THEN
   RAISE EXCEPTION 'expanded_parent_still_published_as_single' USING ERRCODE='22023'; END IF;
  docs=docs||jsonb_build_array(v.document);ids=array_append(ids,v.listing_id);inserted=inserted+1;
  delta=delta||jsonb_build_array(jsonb_build_object('listing_id',v.listing_id,'materialization_hash',v.materialization_hash,'before_state',old_doc,'before_registry_hash',old_registry,'before_lineage',old_lineage));
 END LOOP;
 IF inserted>0 THEN
  PERFORM wf_canonical_staging.apply_publication_records_v2(docs);
  INSERT INTO wf_canonical_staging.expanded_publication_registry_v3(listing_id,materialization_hash)
   SELECT x->>'listing_id',x->>'materialization_hash' FROM jsonb_array_elements(delta) x;
  PERFORM public.reconcile_v2_listing_dealers(ids);
 END IF;
 result=jsonb_build_object('batch_key',p_key,'state','APPLIED','input',cardinality(p_hashes),'inserted',inserted,'identical',identical,'revision_before',revision,
  'revision',(SELECT x.revision FROM wf_canonical_staging.publication_revision x WHERE singleton),'replayed',false);
 INSERT INTO wf_canonical_staging.expanded_publication_batches_v3(batch_key,request_hash,state,result) VALUES(p_key,request_hash,'APPLIED',result);
 -- The immutable version already retains the full after-document. Hash-bind it
 -- and lineage here; only prior rows need complete restoration beforeimages.
 INSERT INTO wf_canonical_staging.expanded_publication_batch_rows_v3(batch_key,listing_id,materialization_hash,source_id,before_state,after_state_hash,before_registry_hash,before_lineage,after_lineage_hash)
  SELECT p_key,x->>'listing_id',x->>'materialization_hash',p.source_id,nullif(x->'before_state','null'::jsonb),encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),x->>'before_registry_hash',
   nullif(x->'before_lineage','null'::jsonb),encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex')
  FROM jsonb_array_elements(delta) x JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=x->>'listing_id'
  LEFT JOIN public.seller_listing_lineage_staging l ON l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=p.listing_id AND l.seller_listing_id=p.source_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.publish_expanded_batch_v3(text,bigint,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.finalize_expanded_cohort_v3(p_key text,p_keys text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tf uuid;pr uuid;revision bigint;n integer;result jsonb;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_keys IS NULL OR cardinality(p_keys)<1
  OR cardinality(p_keys)<>(SELECT count(DISTINCT k) FROM unnest(p_keys) k) THEN RAISE EXCEPTION 'expanded_cohort_keys_invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE batch_key=ANY(p_keys) AND transaction_id=pg_current_xact_id() AND state='APPLIED';
 IF n<>cardinality(p_keys) OR n<>(SELECT count(*) FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE transaction_id=pg_current_xact_id() AND state='APPLIED') THEN
  RAISE EXCEPTION 'expanded_cohort_transaction_mismatch' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_batch_rows_v3 WHERE batch_key=ANY(p_keys) GROUP BY listing_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'expanded_cohort_duplicate_listing' USING ERRCODE='22023'; END IF;
 tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 result=jsonb_build_object('cohort_key',p_key,'revision',revision,'batches',n,'trading_snapshot',tf,'price_snapshot',pr,
  'inserted',(SELECT sum((b.result->>'inserted')::bigint) FROM wf_canonical_staging.expanded_publication_batches_v3 b WHERE batch_key=ANY(p_keys)));
 INSERT INTO wf_canonical_staging.expanded_publication_cohorts_v3(cohort_key,transaction_id,batch_keys,result) VALUES(p_key,pg_current_xact_id(),p_keys,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.finalize_expanded_cohort_v3(text,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.guard_expanded_cohort_commit_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;
BEGIN
 IF (SELECT state FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE batch_key=NEW.batch_key)='ROLLED_BACK' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_cohorts_v3 WHERE transaction_id=NEW.transaction_id AND NEW.batch_key=ANY(batch_keys)) THEN
  RAISE EXCEPTION 'expanded_cohort_not_finalized' USING ERRCODE='23514'; END IF;
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton;
 IF (SELECT count(DISTINCT surface) FROM wf_canonical_staging.keyset_snapshot_registry s WHERE s.publication_revision=revision AND s.expires_at>now() AND s.surface IN('trading_floor','price_research'))<>2 THEN
  RAISE EXCEPTION 'expanded_publication_snapshots_missing' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.guard_expanded_cohort_commit_v3() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER expanded_cohort_commit_guard_v3 AFTER INSERT ON wf_canonical_staging.expanded_publication_batches_v3
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN((NEW.result->>'inserted')::integer>0)
 EXECUTE FUNCTION wf_canonical_staging.guard_expanded_cohort_commit_v3();

CREATE FUNCTION wf_canonical_staging.rollback_expanded_batch_data_v3(p_key text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior wf_canonical_staging.expanded_publication_batches_v3;revision bigint;ids text[];n integer;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.expanded_publication_batches_v3 WHERE batch_key=p_key FOR UPDATE;
 IF prior.state='ROLLED_BACK' THEN RETURN prior.result||jsonb_build_object('state','ROLLED_BACK','replayed',true); END IF;
 IF p_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'expanded_rollback_revision_changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_batch_rows_v3 b
  LEFT JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p ON p.listing_id=b.listing_id
  LEFT JOIN wf_canonical_staging.expanded_publication_registry_v3 e ON e.listing_id=b.listing_id
  WHERE b.batch_key=p_key AND (encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') IS DISTINCT FROM b.after_state_hash
   OR e.materialization_hash IS DISTINCT FROM b.materialization_hash OR p.source_id IS DISTINCT FROM b.source_id OR b.before_state IS NOT NULL)) THEN
  RAISE EXCEPTION 'expanded_rollback_after_state_changed' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_batch_rows_v3 b
  LEFT JOIN public.seller_listing_lineage_staging l ON l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=b.listing_id AND l.seller_listing_id=b.source_id
  WHERE b.batch_key=p_key AND encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex') IS DISTINCT FROM b.after_lineage_hash) THEN
  RAISE EXCEPTION 'expanded_rollback_lineage_changed' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(listing_id),'{}') INTO ids FROM wf_canonical_staging.expanded_publication_batch_rows_v3 WHERE batch_key=p_key;
 DELETE FROM wf_canonical_staging.expanded_publication_registry_v3 WHERE listing_id=ANY(ids);
 DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(ids);GET DIAGNOSTICS n=ROW_COUNT;
 -- The publication no longer exists, so its resolver cannot recreate lineage.
 -- Restore exactly the derived rows owned by this batch, retaining prior evidence.
 DELETE FROM public.seller_listing_lineage_staging l USING wf_canonical_staging.expanded_publication_batch_rows_v3 b
  WHERE b.batch_key=p_key AND l.source_system='WF_V2_SOURCE_BOUND' AND l.source_record_id=b.listing_id AND l.seller_listing_id=b.source_id;
 INSERT INTO public.seller_listing_lineage_staging
  SELECT (jsonb_populate_record(NULL::public.seller_listing_lineage_staging,b.before_lineage)).*
  FROM wf_canonical_staging.expanded_publication_batch_rows_v3 b WHERE b.batch_key=p_key AND b.before_lineage IS NOT NULL;
 UPDATE wf_canonical_staging.expanded_publication_batches_v3 SET state='ROLLED_BACK' WHERE batch_key=p_key;
 RETURN jsonb_build_object('batch_key',p_key,'state','ROLLED_BACK','removed',n,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.rollback_expanded_batch_data_v3(text,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.rollback_expanded_batch_v3(p_key text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result=wf_canonical_staging.rollback_expanded_batch_data_v3(p_key,p_revision);
 PERFORM public.open_trading_floor_keyset_snapshot(3600);PERFORM public.open_price_research_keyset_snapshot(3600);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.rollback_expanded_batch_v3(text,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.rollback_expanded_cohort_v3(p_key text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cohort wf_canonical_staging.expanded_publication_cohorts_v3; revision bigint; k text; result jsonb; removed bigint=0; tf uuid;pr uuid;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 IF revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'expanded_rollback_revision_changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT cohort FROM wf_canonical_staging.expanded_publication_cohorts_v3 WHERE cohort_key=p_key FOR UPDATE;
 FOR k IN SELECT key FROM unnest(cohort.batch_keys) WITH ORDINALITY AS x(key,ordinal) ORDER BY ordinal DESC LOOP
  SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton;
  result=wf_canonical_staging.rollback_expanded_batch_data_v3(k,revision);
  removed=removed+coalesce((result->>'removed')::bigint,0);
 END LOOP;
 -- One fresh pair for the entire rollback, even for a large publication cohort.
 tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 RETURN jsonb_build_object('cohort_key',p_key,'state','ROLLED_BACK','removed',removed,'trading_snapshot',tf,'price_snapshot',pr);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.rollback_expanded_cohort_v3(text,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.guard_expanded_rollback_commit_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton;
 IF (SELECT count(DISTINCT surface) FROM wf_canonical_staging.keyset_snapshot_registry s WHERE s.publication_revision=revision AND s.expires_at>now() AND s.surface IN('trading_floor','price_research'))<>2 THEN
  RAISE EXCEPTION 'expanded_rollback_snapshots_missing' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.guard_expanded_rollback_commit_v3() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER expanded_rollback_commit_guard_v3 AFTER UPDATE OF state ON wf_canonical_staging.expanded_publication_batches_v3
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.state='ROLLED_BACK' AND OLD.state IS DISTINCT FROM NEW.state)
 EXECUTE FUNCTION wf_canonical_staging.guard_expanded_rollback_commit_v3();
COMMIT;
