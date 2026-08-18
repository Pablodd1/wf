-- Private, non-publishing live segment bridge. This lane writes immutable raw
-- evidence plus private shadow candidates only. Promotion is a separate review.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS staging;

CREATE OR REPLACE FUNCTION staging.live_shadow_stable_jsonb(p_value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  v_type TEXT := jsonb_typeof(p_value);
  v_result TEXT;
BEGIN
  IF v_type = 'object' THEN
    SELECT '{' || COALESCE(string_agg(to_jsonb(entry.key)::text || ':' || staging.live_shadow_stable_jsonb(entry.value), ',' ORDER BY entry.key COLLATE "C"), '') || '}'
      INTO v_result
      FROM jsonb_each(p_value) AS entry;
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    SELECT '[' || COALESCE(string_agg(staging.live_shadow_stable_jsonb(entry.value), ',' ORDER BY entry.ordinality), '') || ']'
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS entry(value, ordinality);
    RETURN v_result;
  END IF;
  RETURN p_value::text;
END $$;

REVOKE ALL ON FUNCTION staging.live_shadow_stable_jsonb(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS staging.live_shadow_segment_checkpoint (
  lane_key TEXT PRIMARY KEY,
  contract TEXT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  last_created_on TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  last_source_id TEXT NOT NULL DEFAULT '',
  segment_chain_sha256 TEXT NOT NULL CHECK (segment_chain_sha256 ~ '^[0-9a-f]{64}$'),
  raw_rows BIGINT NOT NULL DEFAULT 0,
  candidate_rows BIGINT NOT NULL DEFAULT 0,
  error_rows BIGINT NOT NULL DEFAULT 0,
  publication_writes BIGINT NOT NULL DEFAULT 0 CHECK (publication_writes = 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.live_shadow_segment_batches (
  batch_token TEXT PRIMARY KEY CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  lane_key TEXT NOT NULL REFERENCES staging.live_shadow_segment_checkpoint(lane_key) ON DELETE RESTRICT,
  sequence BIGINT NOT NULL UNIQUE,
  previous_chain_sha256 TEXT NOT NULL CHECK (previous_chain_sha256 ~ '^[0-9a-f]{64}$'),
  next_chain_sha256 TEXT NOT NULL CHECK (next_chain_sha256 ~ '^[0-9a-f]{64}$'),
  raw_file_sha256 TEXT NOT NULL CHECK (raw_file_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_file_sha256 TEXT NOT NULL CHECK (proposal_file_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 TEXT NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  source_rows INTEGER NOT NULL CHECK (source_rows BETWEEN 1 AND 500),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.live_shadow_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message_version_id UUID NOT NULL REFERENCES public.raw_message_versions(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_candidate_hash TEXT NOT NULL CHECK (source_candidate_hash ~ '^[0-9a-f]{64}$'),
  listing_type TEXT CHECK (listing_type IS NULL OR listing_type IN ('WTS', 'WTB')),
  materialization TEXT NOT NULL CHECK (materialization IN ('SINGLE', 'DEFERRED')),
  candidate JSONB,
  review_disposition TEXT,
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  media JSONB NOT NULL,
  public_image_eligible BOOLEAN NOT NULL DEFAULT false CHECK (public_image_eligible = false),
  contact_publication_approved BOOLEAN NOT NULL DEFAULT false CHECK (contact_publication_approved = false),
  publication_status TEXT NOT NULL DEFAULT 'PRIVATE_SHADOW_ONLY' CHECK (publication_status = 'PRIVATE_SHADOW_ONLY'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_record_id, source_candidate_hash)
);

ALTER TABLE staging.live_shadow_segment_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.live_shadow_segment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.live_shadow_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.live_shadow_segment_checkpoint FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON staging.live_shadow_segment_batches FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON staging.live_shadow_candidates FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ingest_live_shadow_segment(
  p_contract TEXT, p_batch_token TEXT, p_sequence BIGINT,
  p_expected_last_created_on TEXT, p_expected_last_source_id TEXT,
  p_next_last_created_on TEXT, p_next_last_source_id TEXT,
  p_expected_previous_chain_sha256 TEXT, p_next_chain_sha256 TEXT,
  p_raw_file_sha256 TEXT, p_proposal_file_sha256 TEXT,
  p_raw_records JSONB, p_staging_records JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_lane CONSTANT TEXT := 'mariadb-live-shadow-v1';
  v_checkpoint staging.live_shadow_segment_checkpoint%ROWTYPE;
  v_existing_batch staging.live_shadow_segment_batches%ROWTYPE;
  v_raw JSONB;
  v_stage JSONB;
  v_message_id UUID;
  v_version_id UUID;
  v_candidate_id UUID;
  v_count INTEGER;
  v_result JSONB;
  v_request_sha256 TEXT;
  v_computed_sha256 TEXT;
  v_computed_candidate_sha256 TEXT;
  v_expected_batch_token TEXT;
  v_expected_next_chain_sha256 TEXT;
  v_stable_candidate JSONB;
  v_existing_version public.raw_message_versions%ROWTYPE;
  v_existing_candidate staging.live_shadow_candidates%ROWTYPE;
  v_cursor_created_on TEXT;
  v_cursor_source_id TEXT;
BEGIN
  IF p_contract <> 'wf-mariadb-live-segment-bridge-v1' OR p_batch_token !~ '^[0-9a-f]{64}$'
    OR p_expected_previous_chain_sha256 !~ '^[0-9a-f]{64}$' OR p_next_chain_sha256 !~ '^[0-9a-f]{64}$'
    OR p_raw_file_sha256 !~ '^[0-9a-f]{64}$' OR p_proposal_file_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid live shadow segment contract or digest';
  END IF;
  IF jsonb_typeof(p_raw_records) <> 'array' OR jsonb_typeof(p_staging_records) <> 'array' THEN
    RAISE EXCEPTION 'segment records must be arrays';
  END IF;
  v_count := jsonb_array_length(p_raw_records);
  IF v_count < 1 OR v_count > 500 OR v_count <> jsonb_array_length(p_staging_records) THEN
    RAISE EXCEPTION 'segment row count must be matched and between 1 and 500';
  END IF;

  v_expected_batch_token := encode(digest(convert_to(staging.live_shadow_stable_jsonb(jsonb_build_object(
    'contract', p_contract,
    'sequence', p_sequence,
    'raw_sha256', p_raw_file_sha256,
    'proposal_sha256', p_proposal_file_sha256
  )), 'UTF8'), 'sha256'), 'hex');
  IF p_batch_token <> v_expected_batch_token THEN
    RAISE EXCEPTION 'batch token does not match the immutable segment file digests';
  END IF;
  v_expected_next_chain_sha256 := encode(digest(convert_to(
    p_expected_previous_chain_sha256 || E'\n' || p_batch_token, 'UTF8'
  ), 'sha256'), 'hex');
  IF p_next_chain_sha256 <> v_expected_next_chain_sha256 THEN
    RAISE EXCEPTION 'next segment chain digest is invalid';
  END IF;
  v_request_sha256 := encode(digest(convert_to(staging.live_shadow_stable_jsonb(jsonb_build_object(
    'contract', p_contract,
    'batch_token', p_batch_token,
    'sequence', p_sequence,
    'expected_last_created_on', p_expected_last_created_on,
    'expected_last_source_id', p_expected_last_source_id,
    'next_last_created_on', p_next_last_created_on,
    'next_last_source_id', p_next_last_source_id,
    'expected_previous_chain_sha256', p_expected_previous_chain_sha256,
    'next_chain_sha256', p_next_chain_sha256,
    'raw_file_sha256', p_raw_file_sha256,
    'proposal_file_sha256', p_proposal_file_sha256,
    'raw_records', p_raw_records,
    'staging_records', p_staging_records
  )), 'UTF8'), 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtext('live_shadow_segment:' || v_lane));
  SELECT * INTO v_existing_batch FROM staging.live_shadow_segment_batches WHERE batch_token = p_batch_token;
  IF FOUND THEN
    IF v_existing_batch.sequence <> p_sequence
      OR v_existing_batch.previous_chain_sha256 <> p_expected_previous_chain_sha256
      OR v_existing_batch.next_chain_sha256 <> p_next_chain_sha256
      OR v_existing_batch.raw_file_sha256 <> p_raw_file_sha256
      OR v_existing_batch.proposal_file_sha256 <> p_proposal_file_sha256
      OR v_existing_batch.request_sha256 <> v_request_sha256
      OR v_existing_batch.source_rows <> v_count THEN
      RAISE EXCEPTION 'batch token replay does not match its immutable request';
    END IF;
    RETURN v_existing_batch.result;
  END IF;

  INSERT INTO staging.live_shadow_segment_checkpoint(lane_key, contract, segment_chain_sha256)
  VALUES (v_lane, p_contract, repeat('0', 64)) ON CONFLICT (lane_key) DO NOTHING;
  SELECT * INTO v_checkpoint FROM staging.live_shadow_segment_checkpoint WHERE lane_key = v_lane FOR UPDATE;
  IF v_checkpoint.contract <> p_contract OR p_sequence <> v_checkpoint.last_sequence + 1
    OR p_expected_last_created_on <> v_checkpoint.last_created_on
    OR p_expected_last_source_id <> v_checkpoint.last_source_id
    OR p_expected_previous_chain_sha256 <> v_checkpoint.segment_chain_sha256 THEN
    RAISE EXCEPTION 'live shadow checkpoint or hash-chain mismatch';
  END IF;
  v_cursor_created_on := p_expected_last_created_on;
  v_cursor_source_id := p_expected_last_source_id;

  FOR v_raw, v_stage IN
    SELECT r.value, s.value FROM jsonb_array_elements(p_raw_records) WITH ORDINALITY r(value,n)
    JOIN jsonb_array_elements(p_staging_records) WITH ORDINALITY s(value,n) USING(n) ORDER BY r.n
  LOOP
    IF v_raw->>'contract' <> 'wf-mariadb-auctions-raw-v1'
      OR v_stage->>'contract' <> 'wf-mariadb-normalized-staging-v1'
      OR v_stage->>'source_record_id' <> v_raw->>'source_record_id'
      OR v_stage->>'source_hash' <> v_raw->>'raw_sha256'
      OR COALESCE(v_raw->>'raw_sha256', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(v_stage->>'source_candidate_hash', '') !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(v_raw->'raw_data') <> 'object'
      OR jsonb_typeof(v_stage->'media') <> 'object'
      OR v_stage::text ~ '"(raw_message|raw_payload|seller_phone|contact_number|from_number)"[[:space:]]*:'
      OR COALESCE((v_stage->>'public_image_eligible')::boolean, true)
      OR COALESCE((v_stage->>'contact_publication_approved')::boolean, true)
      OR v_stage->>'materialization' NOT IN ('SINGLE','DEFERRED')
      OR (v_stage->>'materialization' = 'SINGLE' AND (
        v_stage->'candidate' IS NULL OR jsonb_typeof(v_stage->'candidate') <> 'object'
        OR v_stage->'candidate'->>'listing_type' NOT IN ('WTS','WTB')
      ))
      OR (v_stage->'candidate'->>'listing_type') IS NOT NULL
         AND v_stage->'candidate'->>'listing_type' NOT IN ('WTS','WTB') THEN
      RAISE EXCEPTION 'unsafe or mismatched shadow transport row';
    END IF;
    v_computed_sha256 := encode(digest(convert_to(staging.live_shadow_stable_jsonb(v_raw->'raw_data'), 'UTF8'), 'sha256'), 'hex');
    IF v_computed_sha256 <> v_raw->>'raw_sha256' THEN
      RAISE EXCEPTION 'raw source digest does not match the immutable payload';
    END IF;
    v_stable_candidate := jsonb_build_object(
      'materialization', v_stage->>'materialization',
      'category', v_stage->'category',
      'bundle_status', v_stage->'bundle_status',
      'candidate', v_stage->'candidate',
      'review_disposition', v_stage->'review_disposition',
      'review_reasons', v_stage->'review_reasons',
      'price_research_status', v_stage->'price_research_status'
    );
    v_computed_candidate_sha256 := encode(digest(convert_to(staging.live_shadow_stable_jsonb(v_stable_candidate), 'UTF8'), 'sha256'), 'hex');
    IF v_computed_candidate_sha256 <> v_stage->>'source_candidate_hash' THEN
      RAISE EXCEPTION 'candidate digest does not match the reviewed shadow payload';
    END IF;
    IF COALESCE(v_raw->>'source_created_on','') = '' OR COALESCE(v_raw->>'source_id','') = ''
      OR v_raw->>'source_created_on' < v_cursor_created_on
      OR (v_raw->>'source_created_on' = v_cursor_created_on AND v_raw->>'source_id' <= v_cursor_source_id) THEN
      RAISE EXCEPTION 'raw segment cursor is not strictly increasing';
    END IF;
    v_cursor_created_on := v_raw->>'source_created_on';
    v_cursor_source_id := v_raw->>'source_id';
    IF v_stage->>'materialization' <> 'SINGLE' AND COALESCE(v_stage->'media'->>'source_media_key','') <> '' THEN
      RAISE EXCEPTION 'parent media cannot enter shadow candidates';
    END IF;

    INSERT INTO public.raw_messages(external_message_id, source_platform, received_at, raw_text, raw_payload, processing_status, parser_version)
    VALUES (v_raw->>'source_record_id', 'mariadb', COALESCE((v_raw->>'source_created_on')::timestamptz, now()),
      COALESCE(v_raw->>'raw_message',''), v_raw, 'COPIED_RAW', 'live-shadow-v1')
    ON CONFLICT (source_platform, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING;
    SELECT id INTO v_message_id FROM public.raw_messages WHERE source_platform='mariadb' AND external_message_id=v_raw->>'source_record_id';
    INSERT INTO public.raw_message_versions(raw_message_id, source_record_id, source_hash, source_created_on, observed_at, raw_message_source, raw_text, raw_payload, media)
    VALUES (v_message_id, v_raw->>'source_record_id', v_raw->>'raw_sha256', v_raw->>'source_created_on', now(),
      v_raw->>'raw_message_source', v_raw->>'raw_message', v_raw, '[]'::jsonb)
    ON CONFLICT (raw_message_id, source_hash) DO NOTHING;
    SELECT * INTO v_existing_version FROM public.raw_message_versions
      WHERE raw_message_id=v_message_id AND source_hash=v_raw->>'raw_sha256';
    IF NOT FOUND OR v_existing_version.source_record_id <> v_raw->>'source_record_id'
      OR v_existing_version.source_hash <> v_raw->>'raw_sha256'
      OR v_existing_version.source_created_on IS DISTINCT FROM v_raw->>'source_created_on'
      OR v_existing_version.raw_message_source IS DISTINCT FROM v_raw->>'raw_message_source'
      OR v_existing_version.raw_text IS DISTINCT FROM v_raw->>'raw_message'
      OR v_existing_version.raw_payload IS DISTINCT FROM v_raw
      OR v_existing_version.media IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'existing raw version does not match immutable incoming lineage';
    END IF;
    v_version_id := v_existing_version.id;
    INSERT INTO staging.live_shadow_candidates(raw_message_version_id, source_record_id, source_hash, source_candidate_hash,
      listing_type, materialization, candidate, review_disposition, review_reasons, media)
    VALUES (v_version_id, v_stage->>'source_record_id', v_stage->>'source_hash', v_stage->>'source_candidate_hash',
      v_stage->'candidate'->>'listing_type', v_stage->>'materialization', v_stage->'candidate',
      v_stage->>'review_disposition', COALESCE(v_stage->'review_reasons','[]'::jsonb), v_stage->'media')
    ON CONFLICT (source_record_id, source_candidate_hash) DO NOTHING;
    SELECT * INTO v_existing_candidate FROM staging.live_shadow_candidates
      WHERE source_record_id=v_stage->>'source_record_id'
        AND source_candidate_hash=v_stage->>'source_candidate_hash';
    IF NOT FOUND OR v_existing_candidate.raw_message_version_id <> v_version_id
      OR v_existing_candidate.source_hash <> v_stage->>'source_hash'
      OR v_existing_candidate.listing_type IS DISTINCT FROM v_stage->'candidate'->>'listing_type'
      OR v_existing_candidate.materialization <> v_stage->>'materialization'
      OR v_existing_candidate.candidate IS DISTINCT FROM v_stage->'candidate'
      OR v_existing_candidate.review_disposition IS DISTINCT FROM v_stage->>'review_disposition'
      OR v_existing_candidate.review_reasons IS DISTINCT FROM COALESCE(v_stage->'review_reasons','[]'::jsonb)
      OR v_existing_candidate.media IS DISTINCT FROM v_stage->'media'
      OR v_existing_candidate.public_image_eligible
      OR v_existing_candidate.contact_publication_approved
      OR v_existing_candidate.publication_status <> 'PRIVATE_SHADOW_ONLY' THEN
      RAISE EXCEPTION 'existing shadow candidate does not match immutable incoming lineage';
    END IF;
  END LOOP;
  IF v_cursor_created_on <> p_next_last_created_on OR v_cursor_source_id <> p_next_last_source_id THEN
    RAISE EXCEPTION 'next cursor does not match the final raw row';
  END IF;

  v_result := jsonb_build_object('raw_accounted',v_count,'staging_accounted',v_count,'error_rows',0,
    'publication_writes',0,'watch_records_writes',0,'release_writes',0,'dealer_writes',0,
    'idempotent',true,'segment_chain_sha256',p_next_chain_sha256);
  INSERT INTO staging.live_shadow_segment_batches(batch_token,lane_key,sequence,previous_chain_sha256,next_chain_sha256,
    raw_file_sha256,proposal_file_sha256,request_sha256,source_rows,result)
  VALUES(p_batch_token,v_lane,p_sequence,p_expected_previous_chain_sha256,p_next_chain_sha256,
    p_raw_file_sha256,p_proposal_file_sha256,v_request_sha256,v_count,v_result);
  UPDATE staging.live_shadow_segment_checkpoint SET last_sequence=p_sequence,last_created_on=p_next_last_created_on,
    last_source_id=p_next_last_source_id,segment_chain_sha256=p_next_chain_sha256,
    raw_rows=raw_rows+v_count,candidate_rows=candidate_rows+v_count,updated_at=now() WHERE lane_key=v_lane;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.ingest_live_shadow_segment(TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_live_shadow_segment(TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  TO service_role;

COMMIT;
