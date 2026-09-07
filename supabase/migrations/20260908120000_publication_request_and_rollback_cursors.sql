BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE wf_canonical_staging.publication_batches_v2 ADD COLUMN request_document jsonb;
ALTER FUNCTION public.publish_materialized_batch_v2(text,bigint,text[],boolean) SET SCHEMA wf_canonical_staging;
REVOKE ALL ON FUNCTION wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.publish_materialized_batch_v2(p_batch_key text,p_expected_revision bigint,p_hashes text[],p_disposable boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 result=wf_canonical_staging.publish_materialized_batch_v2(p_batch_key,p_expected_revision,p_hashes,p_disposable);
 UPDATE wf_canonical_staging.publication_batches_v2 SET request_document=jsonb_build_object('expected_revision',p_expected_revision,
  'hashes',(SELECT jsonb_agg(h ORDER BY h) FROM unnest(p_hashes) h),'disposable',p_disposable)
 WHERE batch_key=p_batch_key AND request_document IS NULL;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.publish_materialized_batch_v2(text,bigint,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.rollback_materialized_batch_v2(p_batch_key text,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE prior wf_canonical_staging.publication_batches_v2; current_revision bigint; records jsonb; ids text[]; result jsonb;
 deleted integer=0; expired integer=0;
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
 IF cardinality(ids)>0 THEN
  IF jsonb_array_length(records)>0 THEN PERFORM wf_canonical_staging.apply_publication_records_v2(records); END IF;
  DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c USING wf_canonical_staging.publication_batch_rows_v2 b
  WHERE b.batch_key=p_batch_key AND b.before_state IS NULL AND c.listing_id=b.listing_id;
  GET DIAGNOSTICS deleted=ROW_COUNT;
  PERFORM public.reconcile_v2_listing_dealers(ids);
  -- Rollback deliberately ends existing traversals. Frozen payloads remain as
  -- private evidence but no old cursor may continue exposing withdrawn records.
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=now() WHERE expires_at>now();
  GET DIAGNOSTICS expired=ROW_COUNT;
  PERFORM public.open_trading_floor_keyset_snapshot(3600);
  PERFORM public.open_price_research_keyset_snapshot(3600);
 END IF;
 SELECT revision INTO STRICT current_revision FROM wf_canonical_staging.publication_revision WHERE singleton;
 result=prior.result||jsonb_build_object('state','ROLLED_BACK','rollback_revision',current_revision,'removed_insertions',deleted,
  'restored_updates',jsonb_array_length(records),'expired_traversals',expired);
 UPDATE wf_canonical_staging.publication_batches_v2 SET state='ROLLED_BACK',rolled_back_at=now(),result=result WHERE batch_key=p_batch_key;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.rollback_materialized_batch_v2(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
