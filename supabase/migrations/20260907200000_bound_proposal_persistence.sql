-- Bind persisted normalization to immutable raw bytes and the complete proposal.
-- Private raw remains untouched. Old proposal states survive in an append-only ledger.
BEGIN;
ALTER TABLE wf_canonical_staging.mariadb_normalized_proposals
  ADD COLUMN listing_text_evidence text,
  ADD COLUMN brand_source_evidence text,
  ADD COLUMN model_source_evidence text,
  ADD COLUMN reference_source_evidence text,
  ADD COLUMN reconciliation_category text,
  ADD COLUMN proposal_document jsonb,
  ADD COLUMN proposal_canonical_json text;
CREATE TABLE wf_canonical_staging.normalized_proposal_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  prior_state jsonb NOT NULL
);
CREATE INDEX normalized_proposal_versions_identity ON wf_canonical_staging.normalized_proposal_versions(proposal_id,id);
ALTER TABLE wf_canonical_staging.normalized_proposal_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.normalized_proposal_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION wf_canonical_staging.retain_normalized_proposal_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO wf_canonical_staging.normalized_proposal_versions(proposal_id,prior_state)
  VALUES (OLD.id,to_jsonb(OLD));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.retain_normalized_proposal_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retain_normalized_proposal_version BEFORE UPDATE
ON wf_canonical_staging.mariadb_normalized_proposals FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION wf_canonical_staging.retain_normalized_proposal_version();

ALTER FUNCTION public.upsert_mariadb_normalized_proposals_batch(jsonb)
  SET SCHEMA wf_canonical_staging;
REVOKE ALL ON FUNCTION wf_canonical_staging.upsert_mariadb_normalized_proposals_batch(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.upsert_mariadb_normalized_proposals_batch(p_proposals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE elem jsonb; raw wf_canonical_staging.mariadb_raw_source_rows;
  doc jsonb; result jsonb;
BEGIN
  IF jsonb_typeof(p_proposals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_proposals)>1000 THEN
    RAISE EXCEPTION 'invalid_proposal_batch' USING ERRCODE='22023';
  END IF;
  -- Serialize the bounded writer; all validation and persistence is one transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(724050,2);
  FOR elem IN SELECT value FROM jsonb_array_elements(p_proposals) LOOP
    SELECT r.* INTO raw FROM wf_canonical_staging.mariadb_raw_source_rows r
    WHERE r.source_system=elem->>'source_system' AND r.source_database=elem->>'source_database'
      AND r.source_table=elem->>'source_table' AND r.source_id=elem->>'source_id'
      AND r.source_hash=elem->>'source_hash';
    IF NOT FOUND OR raw.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact'
      OR raw.hash_algorithm IS DISTINCT FROM 'sha256'
      OR raw.source_record_id IS DISTINCT FROM elem->>'source_record_id'
      OR raw.raw_payload ? '_lossless_raw_evidence'
      OR (elem->>'_source_canonical_json')::jsonb IS DISTINCT FROM raw.raw_payload
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(elem->>'_source_canonical_json','UTF8'),'sha256'),'hex')
         IS DISTINCT FROM raw.source_hash THEN
      RAISE EXCEPTION 'proposal_raw_content_mismatch' USING ERRCODE='22023';
    END IF;
    SELECT jsonb_object_agg(key,COALESCE(elem->key,'null'::jsonb)) INTO doc
    FROM unnest(ARRAY['source_id', 'source_hash', 'source_system', 'source_database', 'source_table', 'source_record_id', 'source_observed_at', 'posted_at', 'listing_text_source', 'listing_text_evidence', 'listing_text_sha256', 'brand', 'brand_source_evidence', 'model', 'model_source_evidence', 'reference', 'reference_source_evidence', 'dial_color', 'year', 'condition', 'intent', 'original_price_amount', 'original_price_currency', 'currency_evidence', 'price_usd', 'fx_rate', 'fx_source', 'fx_date', 'currency_status', 'seller_name', 'seller_contact', 'contact_publication_approved', 'seller_activity_count', 'seller_rating', 'seller_rating_status', 'seller_review_evidence', 'location', 'image_key', 'image_url', 'image_evidence_type', 'bundle_parent_id', 'bundle_child_lineage', 'is_bundle', 'trading_floor_status', 'trading_floor_eligible', 'price_research_status', 'price_research_eligible', 'review_flags', 'reconciliation_category', 'exclusion_reasons', 'parser_version']) AS keys(key);
    -- Normalize timestamp spellings in the comparison; preserve the canonical
    -- proposal document exactly as hashed by the normalizer.
    doc=jsonb_set(doc,'{posted_at}',COALESCE(to_jsonb(to_char((elem->>'posted_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'null'::jsonb));
    doc=jsonb_set(doc,'{source_observed_at}',COALESCE(to_jsonb(to_char((elem->>'source_observed_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'null'::jsonb));
    IF (elem->>'_proposal_canonical_json')::jsonb IS DISTINCT FROM doc
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(elem->>'_proposal_canonical_json','UTF8'),'sha256'),'hex')
         IS DISTINCT FROM elem->>'proposal_hash'
      OR elem->>'proposal_hash' IS NULL THEN
      RAISE EXCEPTION 'proposal_content_mismatch' USING ERRCODE='22023';
    END IF;
    IF (elem->>'listing_text_source' IS NOT NULL AND elem->>'listing_text_source' NOT IN ('description','title','comments'))
      OR elem->>'listing_text_evidence' IS DISTINCT FROM btrim(raw.raw_payload->>(elem->>'listing_text_source'), chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(elem->>'listing_text_evidence','UTF8'),'sha256'),'hex')
         IS DISTINCT FROM elem->>'listing_text_sha256' THEN
      RAISE EXCEPTION 'proposal_text_content_mismatch' USING ERRCODE='22023';
    END IF;
  END LOOP;
  result=wf_canonical_staging.upsert_mariadb_normalized_proposals_batch(p_proposals);
  FOR elem IN SELECT value FROM jsonb_array_elements(p_proposals) LOOP
    UPDATE wf_canonical_staging.mariadb_normalized_proposals p SET
      listing_text_evidence=elem->>'listing_text_evidence',
      brand_source_evidence=elem->>'brand_source_evidence',
      model_source_evidence=elem->>'model_source_evidence',
      reference_source_evidence=elem->>'reference_source_evidence',
      reconciliation_category=elem->>'reconciliation_category',
      proposal_document=(elem->>'_proposal_canonical_json')::jsonb,
      proposal_canonical_json=elem->>'_proposal_canonical_json'
    WHERE p.source_system=elem->>'source_system' AND p.source_database=elem->>'source_database'
      AND p.source_table=elem->>'source_table' AND p.source_id=elem->>'source_id'
      AND p.source_hash=elem->>'source_hash'
      AND p.proposal_canonical_json IS DISTINCT FROM elem->>'_proposal_canonical_json';
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_mariadb_normalized_proposals_batch(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mariadb_normalized_proposals_batch(jsonb) TO service_role;
COMMIT;
