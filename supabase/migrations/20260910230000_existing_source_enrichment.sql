-- Fill source-backed gaps on already reviewed singles. Raw, image, identity,
-- nonnull specifications and existing USD/FX evidence are never replaced.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.propose_existing_enrichment_v3(p_listing text,p_raw uuid,p_source_hash text,p_before_hash text,p_candidate text DEFAULT NULL,p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_doc jsonb; r wf_canonical_staging.mariadb_raw_source_rows;
 c wf_canonical_staging.expanded_listing_candidates_v3; v wf_canonical_staging.expanded_listing_versions_v3;
 candidate jsonb;f jsonb;values_doc jsonb='{}';patch jsonb='{}';conflicts jsonb='[]';k text;has_usd boolean;price_conflict boolean;
BEGIN
 SELECT to_jsonb(x) INTO STRICT current_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 x WHERE listing_id=p_listing;
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw;
 IF encode(sha256(convert_to(current_doc::text,'UTF8')),'hex') IS DISTINCT FROM p_before_hash
  OR current_doc->>'source_id' IS DISTINCT FROM r.source_id OR current_doc->>'source_hash' IS DISTINCT FROM r.source_hash
  OR r.source_hash IS DISTINCT FROM p_source_hash OR current_doc->>'raw_message_id' IS DISTINCT FROM p_raw::text
  OR current_doc->>'parent_listing_id' IS NOT NULL OR current_doc->>'child_index' IS NOT NULL
  OR current_doc->'is_bundle' IS DISTINCT FROM 'false'::jsonb OR current_doc->>'category' IS DISTINCT FROM 'WATCH'
  OR coalesce(current_doc->>'intent','') NOT IN('WTS','WTB')
  OR current_doc->>'raw_message_text' IS NULL OR NOT EXISTS(SELECT 1 FROM unnest(ARRAY['description','title','comments']) field WHERE r.raw_payload->>field=current_doc->>'raw_message_text')
  OR r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence' OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM r.source_hash THEN
  RAISE EXCEPTION 'existing_enrichment_source_or_beforeimage_changed' USING ERRCODE='22023'; END IF;
 values_doc=jsonb_build_object('source_listing_status',r.raw_payload->>'status','source_created_at_text',r.raw_payload->>'created_on');
 values_doc=values_doc||jsonb_build_object('location_country',nullif(btrim(r.raw_payload->>'country'),''),
  'location_region',coalesce(nullif(btrim(r.raw_payload->>'location'),''),nullif(btrim(r.raw_payload->>'region'),'')));
 IF r.raw_payload ? 'deleted_on' THEN values_doc=values_doc||jsonb_build_object('source_deleted',nullif(r.raw_payload->>'deleted_on','') IS NOT NULL);END IF;
 -- Preserve local wall-clock text. A timestamptz requires an explicit source zone.
 IF r.raw_payload->>'created_on' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
  BEGIN
   IF r.raw_payload->>'created_on' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$' THEN
    RAISE EXCEPTION 'unsupported_source_timestamp_format' USING ERRCODE='22007';END IF;
   PERFORM (r.raw_payload->>'created_on')::timestamptz;
   -- Keep the exact microseconds and source offset in the reviewed patch;
   -- the typed record conversion below binds the actual persisted value.
   values_doc=values_doc||jsonb_build_object('source_created_at',r.raw_payload->>'created_on');
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN conflicts=conflicts||'"INVALID_EXPLICIT_SOURCE_TIMESTAMP"'::jsonb;END;
 END IF;
 IF p_candidate IS NULL AND p_version IS NOT NULL THEN RAISE EXCEPTION 'existing_enrichment_version_without_candidate' USING ERRCODE='22023';END IF;
 IF p_candidate IS NOT NULL THEN
  SELECT * INTO STRICT c FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=p_candidate;
  candidate=wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash);f=candidate->'fields';
  IF c.raw_row_id IS DISTINCT FROM p_raw OR c.source_hash IS DISTINCT FROM r.source_hash OR c.kind IS DISTINCT FROM 'SINGLE'
   OR (current_doc->>'brand',current_doc->>'reference',current_doc->>'intent') IS DISTINCT FROM (f->>'brand',f->>'reference',f->>'intent') THEN
   RAISE EXCEPTION 'existing_enrichment_candidate_identity_or_scope_changed' USING ERRCODE='22023';END IF;
  FOREACH k IN ARRAY ARRAY['model','dial_color','year','condition'] LOOP
   IF current_doc->>k IS NOT NULL AND f->>k IS NOT NULL AND current_doc->k IS DISTINCT FROM f->k THEN conflicts=conflicts||to_jsonb(k);
   ELSE values_doc=values_doc||jsonb_build_object(k,f->k);END IF;
  END LOOP;
  IF p_version IS NOT NULL THEN
   SELECT * INTO STRICT v FROM wf_canonical_staging.expanded_listing_versions_v3 WHERE materialization_hash=p_version;
   IF v.candidate_hash IS DISTINCT FROM p_candidate OR v.raw_row_id IS DISTINCT FROM p_raw OR v.listing_id IS DISTINCT FROM p_listing
    OR wf_canonical_staging.materialize_expanded_candidate_v3(p_candidate,v.fx_evidence_hash,v.image_evidence_hash)->>'materialization_hash' IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'existing_enrichment_materialization_changed' USING ERRCODE='22023';END IF;
   price_conflict=(current_doc->>'original_price_amount' IS NOT NULL AND (current_doc->>'original_price_amount')::numeric IS DISTINCT FROM (v.document->>'original_price_amount')::numeric)
    OR (current_doc->>'original_price_currency' IS NOT NULL AND current_doc->>'original_price_currency' IS DISTINCT FROM v.document->>'original_price_currency')
    OR (current_doc->>'original_price_role' IS NOT NULL AND current_doc->>'original_price_role' IS DISTINCT FROM v.document->>'original_price_role');
   IF price_conflict THEN conflicts=conflicts||'"ORIGINAL_PRICE_CONFLICT"'::jsonb;
   ELSE
    has_usd=current_doc->>'price_usd' IS NOT NULL;
    FOREACH k IN ARRAY ARRAY['original_price_text','original_price_amount','original_price_currency','original_price_role','price_usd','fx_rate','fx_source','fx_date'] LOOP
     IF NOT(has_usd AND k=ANY(ARRAY['price_usd','fx_rate','fx_source','fx_date'])) THEN values_doc=values_doc||jsonb_build_object(k,v.document->k);END IF;
    END LOOP;
    IF NOT has_usd AND v.document->>'original_price_amount' IS NOT NULL THEN
     IF current_doc->'price_status' IS DISTINCT FROM v.document->'price_status' THEN patch=patch||jsonb_build_object('price_status',v.document->'price_status');END IF;
     IF current_doc->>'intent'='WTS' AND (current_doc->>'statistics_exclusion_reason' IS NULL OR current_doc->>'statistics_exclusion_reason'=ANY(ARRAY['PRICE_NOT_SUPPLIED','UNRESOLVED_CURRENCY','SOURCE_CURRENCY_NOT_ESTABLISHED','FX_RATE_UNAVAILABLE'])) THEN
      FOREACH k IN ARRAY ARRAY['price_research_eligible','included_in_statistics','statistics_exclusion_reason'] LOOP
       IF current_doc->k IS DISTINCT FROM v.document->k THEN patch=patch||jsonb_build_object(k,v.document->k);END IF;
      END LOOP;
     ELSIF current_doc->>'intent'='WTS' THEN conflicts=conflicts||'"PRESERVED_NON_PRICE_RESEARCH_EXCLUSION"'::jsonb;END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 FOR k IN SELECT jsonb_object_keys(values_doc) LOOP
  IF current_doc->>k IS NULL AND values_doc->>k IS NOT NULL THEN patch=patch||jsonb_build_object(k,values_doc->k);END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) INTO conflicts FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(conflicts)) reasons;
 RETURN jsonb_build_object('patch',patch,'review_reasons',conflicts,'before_hash',p_before_hash,
  'after_hash',encode(sha256(convert_to(to_jsonb(jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,current_doc||patch))::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.propose_existing_enrichment_v3(text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE wf_canonical_staging.existing_enrichment_batches_v3 (
 batch_key text PRIMARY KEY,request_hash text NOT NULL,review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),state text NOT NULL CHECK(state IN('APPLIED','ROLLED_BACK')),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX existing_enrichment_transaction_v3 ON wf_canonical_staging.existing_enrichment_batches_v3(transaction_id);
CREATE TABLE wf_canonical_staging.existing_enrichment_rows_v3 (
 batch_key text NOT NULL REFERENCES wf_canonical_staging.existing_enrichment_batches_v3(batch_key),listing_id text NOT NULL,
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),source_hash text NOT NULL,
 candidate_hash text REFERENCES wf_canonical_staging.expanded_listing_candidates_v3(candidate_hash),materialization_hash text REFERENCES wf_canonical_staging.expanded_listing_versions_v3(materialization_hash),
 before_state jsonb NOT NULL,patch jsonb NOT NULL,after_state_hash text NOT NULL,review_reasons jsonb NOT NULL,PRIMARY KEY(batch_key,listing_id)
);
CREATE TABLE wf_canonical_staging.existing_enrichment_cohorts_v3 (
 cohort_key text PRIMARY KEY,transaction_id xid8 NOT NULL UNIQUE,batch_keys text[] NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.existing_enrichment_batches_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.existing_enrichment_rows_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.existing_enrichment_cohorts_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.existing_enrichment_batches_v3,wf_canonical_staging.existing_enrichment_rows_v3,wf_canonical_staging.existing_enrichment_cohorts_v3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.apply_existing_enrichment_batch_v3(p_key text,p_revision bigint,p_review text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;request_hash text;prior wf_canonical_staging.existing_enrichment_batches_v3;x jsonb;old_doc jsonb;proposal jsonb;docs jsonb='[]';deltas jsonb='[]';n integer=0;result jsonb;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_review IS NULL OR p_review !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500
  OR jsonb_array_length(p_rows)<>(SELECT count(DISTINCT e->>'listing_id') FROM jsonb_array_elements(p_rows) e) THEN RAISE EXCEPTION 'existing_enrichment_request_invalid' USING ERRCODE='22023';END IF;
 request_hash=encode(sha256(convert_to(jsonb_build_array(p_revision,p_review,p_rows)::text,'UTF8')),'hex');
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.existing_enrichment_batches_v3 WHERE batch_key=p_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'existing_enrichment_replay_changed' USING ERRCODE='22023';END IF;
  RETURN prior.result||jsonb_build_object('state',prior.state,'replayed',true);
 END IF;
 IF p_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'existing_enrichment_revision_changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 FOR x IN SELECT e FROM jsonb_array_elements(p_rows) e ORDER BY e->>'listing_id' LOOP
  SELECT to_jsonb(p) INTO STRICT old_doc FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p WHERE listing_id=x->>'listing_id' FOR UPDATE;
  proposal=wf_canonical_staging.propose_existing_enrichment_v3(x->>'listing_id',(x->>'raw_row_id')::uuid,x->>'source_hash',x->>'before_hash',x->>'candidate_hash',x->>'materialization_hash');
  IF proposal->>'after_hash' IS DISTINCT FROM x->>'after_hash' OR proposal->'patch' IS DISTINCT FROM x->'patch'
   OR proposal->'review_reasons' IS DISTINCT FROM x->'review_reasons' THEN RAISE EXCEPTION 'existing_enrichment_reviewed_proposal_changed' USING ERRCODE='22023';END IF;
  IF proposal->'patch'<>'{}'::jsonb THEN
   docs=docs||jsonb_build_array(old_doc||(proposal->'patch'));deltas=deltas||jsonb_build_array(x||jsonb_build_object('before_state',old_doc));n=n+1;
  END IF;
 END LOOP;
 IF n>0 THEN PERFORM wf_canonical_staging.apply_publication_records_v2(docs);END IF;
 result=jsonb_build_object('batch_key',p_key,'changed',n,'input',jsonb_array_length(p_rows),'state','APPLIED','revision_before',revision,'revision',(SELECT q.revision FROM wf_canonical_staging.publication_revision q WHERE singleton));
 INSERT INTO wf_canonical_staging.existing_enrichment_batches_v3(batch_key,request_hash,review_manifest_sha256,state,result) VALUES(p_key,request_hash,p_review,'APPLIED',result);
 INSERT INTO wf_canonical_staging.existing_enrichment_rows_v3(batch_key,listing_id,raw_row_id,source_hash,candidate_hash,materialization_hash,before_state,patch,after_state_hash,review_reasons)
  SELECT p_key,e->>'listing_id',(e->>'raw_row_id')::uuid,e->>'source_hash',e->>'candidate_hash',e->>'materialization_hash',e->'before_state',e->'patch',e->>'after_hash',e->'review_reasons' FROM jsonb_array_elements(deltas) e;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.apply_existing_enrichment_batch_v3(text,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.finalize_existing_enrichment_v3(p_key text,p_keys text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;n integer;tf uuid;pr uuid;result jsonb;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_keys IS NULL OR cardinality(p_keys)<1
  OR cardinality(p_keys)<>(SELECT count(DISTINCT k) FROM unnest(p_keys) k) THEN RAISE EXCEPTION 'existing_enrichment_cohort_keys_invalid' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO n FROM wf_canonical_staging.existing_enrichment_batches_v3 WHERE batch_key=ANY(p_keys) AND transaction_id=pg_current_xact_id() AND state='APPLIED';
 IF n<>cardinality(p_keys) OR n<>(SELECT count(*) FROM wf_canonical_staging.existing_enrichment_batches_v3 WHERE transaction_id=pg_current_xact_id() AND state='APPLIED')
  OR EXISTS(SELECT 1 FROM wf_canonical_staging.existing_enrichment_rows_v3 WHERE batch_key=ANY(p_keys) GROUP BY listing_id HAVING count(*)>1) THEN RAISE EXCEPTION 'existing_enrichment_cohort_transaction_invalid' USING ERRCODE='22023';END IF;
 PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();
 tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 result=jsonb_build_object('cohort_key',p_key,'revision',revision,'batches',n,'trading_snapshot',tf,'price_snapshot',pr,'changed',(SELECT sum((b.result->>'changed')::bigint) FROM wf_canonical_staging.existing_enrichment_batches_v3 b WHERE batch_key=ANY(p_keys)));
 INSERT INTO wf_canonical_staging.existing_enrichment_cohorts_v3(cohort_key,transaction_id,batch_keys,result) VALUES(p_key,pg_current_xact_id(),p_keys,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.finalize_existing_enrichment_v3(text,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.guard_existing_enrichment_commit_v3() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;
BEGIN
 IF TG_OP='INSERT' AND (SELECT state FROM wf_canonical_staging.existing_enrichment_batches_v3 WHERE batch_key=NEW.batch_key)='APPLIED'
  AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.existing_enrichment_cohorts_v3 WHERE transaction_id=NEW.transaction_id AND NEW.batch_key=ANY(batch_keys)) THEN RAISE EXCEPTION 'existing_enrichment_not_finalized' USING ERRCODE='23514';END IF;
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton;
 IF (SELECT count(DISTINCT surface) FROM wf_canonical_staging.keyset_snapshot_registry WHERE publication_revision=revision AND expires_at>now() AND surface IN('trading_floor','price_research'))<>2 THEN RAISE EXCEPTION 'existing_enrichment_snapshots_missing' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.guard_existing_enrichment_commit_v3() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER existing_enrichment_commit_guard_v3 AFTER INSERT ON wf_canonical_staging.existing_enrichment_batches_v3 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN((NEW.result->>'changed')::integer>0) EXECUTE FUNCTION wf_canonical_staging.guard_existing_enrichment_commit_v3();
CREATE CONSTRAINT TRIGGER existing_enrichment_rollback_guard_v3 AFTER UPDATE OF state ON wf_canonical_staging.existing_enrichment_batches_v3 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION wf_canonical_staging.guard_existing_enrichment_commit_v3();

CREATE FUNCTION wf_canonical_staging.rollback_existing_enrichment_v3(p_key text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;cohort wf_canonical_staging.existing_enrichment_cohorts_v3;b wf_canonical_staging.existing_enrichment_batches_v3;docs jsonb;changed integer=0;tf uuid;pr uuid;
BEGIN
 SELECT x.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision x WHERE singleton FOR UPDATE;
 IF p_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'existing_enrichment_rollback_revision_changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 SELECT * INTO STRICT cohort FROM wf_canonical_staging.existing_enrichment_cohorts_v3 WHERE cohort_key=p_key;
 FOR b IN SELECT x.* FROM unnest(cohort.batch_keys) WITH ORDINALITY k(key,ordinal) JOIN wf_canonical_staging.existing_enrichment_batches_v3 x ON x.batch_key=k.key ORDER BY k.ordinal DESC FOR UPDATE OF x LOOP
  IF b.state='ROLLED_BACK' THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.existing_enrichment_rows_v3 e LEFT JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 p USING(listing_id)
   WHERE e.batch_key=b.batch_key AND encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') IS DISTINCT FROM e.after_state_hash) THEN RAISE EXCEPTION 'existing_enrichment_rollback_after_state_changed' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(before_state),'[]'::jsonb) INTO docs FROM wf_canonical_staging.existing_enrichment_rows_v3 WHERE batch_key=b.batch_key;
  IF jsonb_array_length(docs)>0 THEN PERFORM wf_canonical_staging.apply_publication_records_v2(docs);changed=changed+jsonb_array_length(docs);END IF;
  UPDATE wf_canonical_staging.existing_enrichment_batches_v3 SET state='ROLLED_BACK' WHERE batch_key=b.batch_key;
 END LOOP;
 PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);
 RETURN jsonb_build_object('cohort_key',p_key,'state','ROLLED_BACK','restored',changed,'trading_snapshot',tf,'price_snapshot',pr);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.rollback_existing_enrichment_v3(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
