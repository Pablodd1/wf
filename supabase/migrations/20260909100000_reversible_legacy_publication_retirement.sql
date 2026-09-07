-- Retire only reviewed legacy publication documents. Immutable source evidence
-- is untouched, and the exact previous public documents remain restorable.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.legacy_publication_retirements_v2 (
 retirement_key text PRIMARY KEY,state text NOT NULL CHECK(state IN('RETIRED','RESTORED')),
 listing_ids text[] NOT NULL,records jsonb NOT NULL,records_sha256 text NOT NULL,
 retired_at timestamptz NOT NULL DEFAULT now(),restored_at timestamptz,
 CHECK(jsonb_typeof(records)='array'),CHECK(jsonb_array_length(records)=cardinality(listing_ids)),
 CHECK(encode(sha256(convert_to(records::text,'UTF8')),'hex')=records_sha256)
);
ALTER TABLE wf_canonical_staging.legacy_publication_retirements_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.legacy_publication_retirements_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retire_legacy_publication_v2(p_key text,p_expected_revision bigint,p_listing_ids text[],p_expected_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior wf_canonical_staging.legacy_publication_retirements_v2;revision bigint;records jsonb;digest text;n integer;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR p_listing_ids IS NULL OR cardinality(p_listing_ids) NOT BETWEEN 1 AND 5000
  OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
  OR cardinality(p_listing_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_listing_ids) id) THEN
  RAISE EXCEPTION 'legacy_retirement_request_invalid' USING ERRCODE='22023'; END IF;
 SELECT r.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision r WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.legacy_publication_retirements_v2 WHERE retirement_key=p_key;
 IF FOUND THEN
  IF prior.records_sha256<>p_expected_sha256 OR prior.listing_ids IS DISTINCT FROM p_listing_ids THEN RAISE EXCEPTION 'legacy_retirement_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('state',prior.state,'retired',cardinality(prior.listing_ids),'replayed',true);
 END IF;
 IF p_expected_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'legacy_retirement_revision_changed' USING ERRCODE='40001'; END IF;
 SELECT jsonb_agg(to_jsonb(v) ORDER BY v.listing_id) INTO records FROM
  (SELECT * FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(p_listing_ids) FOR UPDATE) v;
 IF coalesce(jsonb_array_length(records),0)<>cardinality(p_listing_ids) THEN RAISE EXCEPTION 'legacy_retirement_membership_changed' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) r WHERE r->>'raw_message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
  RAISE EXCEPTION 'legacy_retirement_exact_source_member_refused' USING ERRCODE='22023'; END IF;
 digest=encode(sha256(convert_to(records::text,'UTF8')),'hex');
 IF digest<>p_expected_sha256 THEN RAISE EXCEPTION 'legacy_retirement_content_changed' USING ERRCODE='22023'; END IF;
 INSERT INTO wf_canonical_staging.legacy_publication_retirements_v2(retirement_key,state,listing_ids,records,records_sha256)
 VALUES(p_key,'RETIRED',p_listing_ids,records,digest);
 DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(p_listing_ids);
 GET DIAGNOSTICS n=ROW_COUNT;IF n<>cardinality(p_listing_ids) THEN RAISE EXCEPTION 'legacy_retirement_count_mismatch'; END IF;
 PERFORM public.open_trading_floor_keyset_snapshot(3600);PERFORM public.open_price_research_keyset_snapshot(3600);
 RETURN jsonb_build_object('state','RETIRED','retired',n,'records_sha256',digest,'replayed',false);
END $$;

CREATE FUNCTION public.restore_legacy_publication_v2(p_key text,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior wf_canonical_staging.legacy_publication_retirements_v2;revision bigint;
BEGIN
 SELECT r.revision INTO STRICT revision FROM wf_canonical_staging.publication_revision r WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM wf_canonical_staging.legacy_publication_retirements_v2 WHERE retirement_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'legacy_retirement_not_found' USING ERRCODE='22023'; END IF;
 IF prior.state='RESTORED' THEN RETURN jsonb_build_object('state','RESTORED','restored',cardinality(prior.listing_ids),'replayed',true); END IF;
 IF p_expected_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'legacy_restoration_revision_changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(prior.listing_ids)) THEN
  RAISE EXCEPTION 'legacy_restoration_publication_conflict' USING ERRCODE='22023'; END IF;
 PERFORM wf_canonical_staging.apply_publication_records_v2(prior.records);
 UPDATE wf_canonical_staging.legacy_publication_retirements_v2 SET state='RESTORED',restored_at=now() WHERE retirement_key=p_key;
 PERFORM public.open_trading_floor_keyset_snapshot(3600);PERFORM public.open_price_research_keyset_snapshot(3600);
 RETURN jsonb_build_object('state','RESTORED','restored',cardinality(prior.listing_ids),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.retire_legacy_publication_v2(text,bigint,text[],text),public.restore_legacy_publication_v2(text,bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
