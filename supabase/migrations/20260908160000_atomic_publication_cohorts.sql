-- Stream bounded owner-only writes, then reconcile and freeze once per cohort.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE wf_canonical_staging.publication_batches_v2 ADD COLUMN transaction_id xid8;
ALTER TABLE wf_canonical_staging.publication_batches_v2 ALTER COLUMN transaction_id SET DEFAULT pg_current_xact_id();
ALTER TABLE wf_canonical_staging.publication_batches_v2 ADD COLUMN snapshot_deferred boolean NOT NULL DEFAULT false;
CREATE INDEX publication_batches_v2_transaction ON wf_canonical_staging.publication_batches_v2(transaction_id);
CREATE TABLE wf_canonical_staging.publication_cohorts_v2 (
 cohort_key text PRIMARY KEY,transaction_id xid8 NOT NULL UNIQUE,
 batch_keys text[] NOT NULL,request_hash text NOT NULL,
 state text NOT NULL DEFAULT 'APPLIED' CHECK(state IN('APPLIED','PARTIALLY_ROLLED_BACK','ROLLED_BACK')),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.publication_cohorts_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.publication_cohorts_v2 FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE definition text; pair text[]; pairs text[][]=ARRAY[
 ARRAY['SELECT count(*) INTO before_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;',
 $code$IF current_setting('wf.defer_snapshot_prewarm',true)='true' THEN
   SELECT max((b.result->>'after_count')::bigint) INTO before_count FROM wf_canonical_staging.publication_batches_v2 b
   WHERE b.transaction_id=pg_current_xact_id() AND b.state='APPLIED';
  END IF;
  IF before_count IS NULL THEN SELECT count(*) INTO before_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2; END IF;$code$],
 ARRAY[$code$snapshot_tf=public.open_trading_floor_keyset_snapshot(3600);
  snapshot_pr=public.open_price_research_keyset_snapshot(3600);$code$,
 $code$IF current_setting('wf.defer_snapshot_prewarm',true) IS DISTINCT FROM 'true' THEN
   snapshot_tf=public.open_trading_floor_keyset_snapshot(3600);
   snapshot_pr=public.open_price_research_keyset_snapshot(3600);
  END IF;$code$],
 ARRAY['SELECT count(*) INTO after_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;',
 $code$IF current_setting('wf.defer_snapshot_prewarm',true)='true' THEN after_count=before_count+inserted;
  ELSE SELECT count(*) INTO after_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2; END IF;$code$]
 ];
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure);
 FOREACH pair SLICE 1 IN ARRAY pairs LOOP
  IF strpos(definition,pair[1])=0 THEN RAISE EXCEPTION 'publication_cohort_definition_mismatch'; END IF;
  definition=replace(definition,pair[1],pair[2]);
 END LOOP;
 EXECUTE definition;
END $migration$;

CREATE FUNCTION public.stage_publication_cohort_batch_v2(p_batch_key text,p_expected_revision bigint,p_hashes text[],p_disposable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE previous_setting text=current_setting('wf.defer_snapshot_prewarm',true); result jsonb;
BEGIN
 PERFORM set_config('wf.defer_snapshot_prewarm','true',true);
 result=public.publish_materialized_batch_v2(p_batch_key,p_expected_revision,p_hashes,p_disposable);
 PERFORM set_config('wf.defer_snapshot_prewarm',coalesce(previous_setting,'false'),true);
 UPDATE wf_canonical_staging.publication_batches_v2 SET snapshot_deferred=true
 WHERE batch_key=p_batch_key AND transaction_id=pg_current_xact_id() AND snapshot_deferred IS FALSE;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.stage_publication_cohort_batch_v2(text,bigint,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finalize_publication_cohort_v2(p_cohort_key text,p_batch_keys text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE prior wf_canonical_staging.publication_cohorts_v2; request_hash text; v_revision bigint; n integer;
 before_count bigint; after_count bigint; expected_after bigint; inserted bigint; identical bigint; changed bigint; held bigint; inputs bigint;
 result jsonb; tf uuid; pr uuid;
BEGIN
 IF p_cohort_key IS NULL OR p_cohort_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_batch_keys IS NULL OR cardinality(p_batch_keys) NOT BETWEEN 1 AND 10000
  OR cardinality(p_batch_keys)<>(SELECT count(DISTINCT key) FROM unnest(p_batch_keys) key) THEN
  RAISE EXCEPTION 'publication_cohort_request_invalid' USING ERRCODE='22023'; END IF;
 request_hash=encode(extensions.digest(convert_to((SELECT jsonb_agg(key ORDER BY key)::text FROM unnest(p_batch_keys) key),'UTF8'),'sha256'),'hex');
 SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.publication_cohorts_v2 WHERE cohort_key=p_cohort_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'publication_cohort_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN prior.result||jsonb_build_object('state',prior.state,'replayed',true);
 END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.publication_batches_v2 WHERE batch_key=ANY(p_batch_keys)
  AND transaction_id=pg_current_xact_id() AND state='APPLIED' AND snapshot_deferred;
 IF n<>cardinality(p_batch_keys) OR n<>(SELECT count(*) FROM wf_canonical_staging.publication_batches_v2
  WHERE transaction_id=pg_current_xact_id() AND state='APPLIED' AND snapshot_deferred) THEN
  RAISE EXCEPTION 'publication_cohort_membership_mismatch' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.publication_batch_rows_v2 WHERE batch_key=ANY(p_batch_keys)
  GROUP BY listing_id HAVING count(*)>1) THEN RAISE EXCEPTION 'publication_cohort_duplicate_listing' USING ERRCODE='22023'; END IF;
 SELECT min((b.result->>'before_count')::bigint),max((b.result->>'after_count')::bigint),sum((b.result->>'inserted')::bigint),
  sum((b.result->>'identical')::bigint),sum((b.result->>'changed')::bigint),sum((b.result->>'held')::bigint),sum((b.result->>'input')::bigint)
 INTO before_count,expected_after,inserted,identical,changed,held,inputs FROM wf_canonical_staging.publication_batches_v2 b WHERE batch_key=ANY(p_batch_keys);
 SELECT count(*) INTO after_count FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
 IF after_count<>expected_after OR after_count<>before_count+inserted OR inputs<>inserted+identical+changed+held THEN
  RAISE EXCEPTION 'publication_cohort_counts_mismatch' USING ERRCODE='22023'; END IF;
 tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 result=jsonb_build_object('cohort_key',p_cohort_key,'state','APPLIED','batches',n,'input',inputs,'inserted',inserted,'identical',identical,
  'changed',changed,'held',held,'before_count',before_count,'after_count',after_count,'revision',v_revision,'trading_snapshot',tf,'price_snapshot',pr,'replayed',false);
 INSERT INTO wf_canonical_staging.publication_cohorts_v2(cohort_key,transaction_id,batch_keys,request_hash,result)
 VALUES(p_cohort_key,pg_current_xact_id(),p_batch_keys,request_hash,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.finalize_publication_cohort_v2(text,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.guard_publication_snapshot_commit_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE batch wf_canonical_staging.publication_batches_v2; v_revision bigint; surfaces integer;
BEGIN
 SELECT * INTO batch FROM wf_canonical_staging.publication_batches_v2 WHERE batch_key=NEW.batch_key;
 IF batch.state<>'APPLIED' THEN RETURN NULL; END IF;
 IF batch.snapshot_deferred AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.publication_cohorts_v2 c
  WHERE c.transaction_id=batch.transaction_id AND batch.batch_key=ANY(c.batch_keys)) THEN
  RAISE EXCEPTION 'publication_cohort_not_finalized' USING ERRCODE='23514'; END IF;
 SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton;
 SELECT count(DISTINCT surface) INTO surfaces FROM wf_canonical_staging.keyset_snapshot_registry
 WHERE publication_revision=v_revision AND expires_at>now() AND surface IN('trading_floor','price_research');
 IF surfaces<>2 THEN RAISE EXCEPTION 'publication_snapshots_not_prepared' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.guard_publication_snapshot_commit_v2() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER guard_publication_snapshot_commit_v2 AFTER INSERT ON wf_canonical_staging.publication_batches_v2
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN ((NEW.result->>'inserted')::integer+(NEW.result->>'changed')::integer>0)
EXECUTE FUNCTION wf_canonical_staging.guard_publication_snapshot_commit_v2();

CREATE FUNCTION wf_canonical_staging.track_publication_cohort_rollback_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE wf_canonical_staging.publication_cohorts_v2 c SET state=CASE
  WHEN NOT EXISTS(SELECT 1 FROM wf_canonical_staging.publication_batches_v2 b WHERE b.batch_key=ANY(c.batch_keys) AND b.state='APPLIED')
  THEN 'ROLLED_BACK' ELSE 'PARTIALLY_ROLLED_BACK' END
 WHERE NEW.batch_key=ANY(c.batch_keys);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.track_publication_cohort_rollback_v2() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER track_publication_cohort_rollback_v2 AFTER UPDATE OF state ON wf_canonical_staging.publication_batches_v2
FOR EACH ROW WHEN(NEW.state='ROLLED_BACK' AND OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION wf_canonical_staging.track_publication_cohort_rollback_v2();
NOTIFY pgrst,'reload schema';
COMMIT;
