DO $test$
DECLARE
  v_raw_data JSONB := jsonb_build_object(
    'id', 'shadow-db-test-1',
    'created_on', '2026-08-18 00:00:01',
    'title', E'Rolex “Panda” 126500LN\nUSD 25,000 東京' || chr(8232) || 'line',
    'price', 25000.5,
    'nullable', null,
    'tags', jsonb_build_array('WTS', '白', null),
    'escaped', E'quote " slash \\ emoji 🕰️'
  );
  v_raw_hash TEXT;
  v_candidate JSONB := jsonb_build_object(
    'brand', 'Rolex', 'model', 'Cosmograph “Daytona”', 'reference', '126500LN',
    'dial_color', 'White 白', 'condition', 'New', 'listing_type', 'WTS',
    'price', jsonb_build_object('amount_usd', 25000.5, 'currency_original', 'USD')
  );
  v_stable_candidate JSONB;
  v_candidate_hash TEXT;
  v_raw JSONB;
  v_stage JSONB;
  v_raw_file_hash TEXT := encode(digest(convert_to('shadow-raw-file-1', 'UTF8'), 'sha256'), 'hex');
  v_proposal_file_hash TEXT := encode(digest(convert_to('shadow-proposal-file-1', 'UTF8'), 'sha256'), 'hex');
  v_batch_token TEXT;
  v_next_chain TEXT;
  v_result JSONB;
  v_status TEXT;
  v_failed BOOLEAN := false;
BEGIN
  v_raw_hash := encode(digest(convert_to(staging.live_shadow_stable_jsonb(v_raw_data), 'UTF8'), 'sha256'), 'hex');
  IF v_raw_hash <> '2f3456391f1ea48381b13e8de1aa0d8009a990a967feca8a5f5b1c2f9e9028c9' THEN
    RAISE EXCEPTION 'database stable JSON does not match the Node raw payload contract';
  END IF;
  v_stable_candidate := jsonb_build_object(
    'materialization', 'SINGLE',
    'category', 'WATCH',
    'bundle_status', 'SINGLE_CANDIDATE',
    'candidate', v_candidate,
    'review_disposition', 'SHADOW_PENDING_REVIEW',
    'review_reasons', jsonb_build_array('UNICODE_審核', null),
    'price_research_status', 'PRIVATE_SHADOW_ONLY'
  );
  v_candidate_hash := encode(digest(convert_to(staging.live_shadow_stable_jsonb(v_stable_candidate), 'UTF8'), 'sha256'), 'hex');
  IF v_candidate_hash <> 'cbe8a26566fc555c22d6a7a0b7db75bef97905d333d1f4f55ce2a3b61ff73940' THEN
    RAISE EXCEPTION 'database stable JSON does not match the Node candidate contract';
  END IF;
  v_raw := jsonb_build_object(
    'contract', 'wf-mariadb-auctions-raw-v1',
    'source_id', 'shadow-db-test-1',
    'source_record_id', 'mysql_auctions_shadow-db-test-1',
    'source_created_on', '2026-08-18 00:00:01',
    'raw_message', 'Rolex 126500LN USD 25000',
    'raw_message_source', 'title',
    'raw_sha256', v_raw_hash,
    'raw_data', v_raw_data
  );
  v_stage := jsonb_build_object(
    'contract', 'wf-mariadb-normalized-staging-v1',
    'source_record_id', 'mysql_auctions_shadow-db-test-1',
    'source_hash', v_raw_hash,
    'source_candidate_hash', v_candidate_hash,
    'materialization', 'SINGLE',
    'category', 'WATCH',
    'bundle_status', 'SINGLE_CANDIDATE',
    'review_disposition', 'SHADOW_PENDING_REVIEW',
    'review_reasons', jsonb_build_array('UNICODE_審核', null),
    'price_research_status', 'PRIVATE_SHADOW_ONLY',
    'candidate', v_candidate,
    'media', jsonb_build_object('source_media_key', null, 'public_image_eligible', false),
    'public_image_eligible', false,
    'contact_publication_approved', false
  );
  v_batch_token := encode(digest(convert_to(staging.live_shadow_stable_jsonb(jsonb_build_object(
    'contract', 'wf-mariadb-live-segment-bridge-v1',
    'sequence', 1,
    'raw_sha256', v_raw_file_hash,
    'proposal_sha256', v_proposal_file_hash
  )), 'UTF8'), 'sha256'), 'hex');
  IF v_batch_token <> 'c93f6229a6e13a6dfdef9ef49fe2a5e82c7ccec22d2785a85c4c8348b6ab0c28' THEN
    RAISE EXCEPTION 'database stable JSON does not match the Node segment-token contract';
  END IF;
  v_next_chain := encode(digest(convert_to(repeat('0', 64) || E'\n' || v_batch_token, 'UTF8'), 'sha256'), 'hex');

  v_result := public.ingest_live_shadow_segment(
    'wf-mariadb-live-segment-bridge-v1', v_batch_token, 1,
    '1970-01-01 00:00:00', '', '2026-08-18 00:00:01', 'shadow-db-test-1',
    repeat('0', 64), v_next_chain, v_raw_file_hash, v_proposal_file_hash,
    jsonb_build_array(v_raw), jsonb_build_array(v_stage)
  );
  IF (v_result->>'raw_accounted')::integer <> 1
    OR (v_result->>'staging_accounted')::integer <> 1
    OR (v_result->>'publication_writes')::integer <> 0 THEN
    RAISE EXCEPTION 'live shadow integration result did not reconcile';
  END IF;

  IF public.ingest_live_shadow_segment(
    'wf-mariadb-live-segment-bridge-v1', v_batch_token, 1,
    '1970-01-01 00:00:00', '', '2026-08-18 00:00:01', 'shadow-db-test-1',
    repeat('0', 64), v_next_chain, v_raw_file_hash, v_proposal_file_hash,
    jsonb_build_array(v_raw), jsonb_build_array(v_stage)
  ) IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'exact replay did not return the immutable prior result';
  END IF;

  BEGIN
    PERFORM public.ingest_live_shadow_segment(
      'wf-mariadb-live-segment-bridge-v1', v_batch_token, 1,
      '1970-01-01 00:00:00', '', '2026-08-18 00:00:01', 'shadow-db-test-1',
      repeat('0', 64), v_next_chain, v_raw_file_hash, v_proposal_file_hash,
      jsonb_build_array(jsonb_set(v_raw, '{raw_message}', '"altered same-count replay"'::jsonb)),
      jsonb_build_array(v_stage)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'batch token replay does not match its immutable request';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'altered same-count replay was not rejected';
  END IF;

  SELECT processing_status INTO v_status
  FROM public.raw_messages
  WHERE source_platform = 'mariadb' AND external_message_id = 'mysql_auctions_shadow-db-test-1';
  IF v_status <> 'COPIED_RAW' THEN
    RAISE EXCEPTION 'shadow raw envelope entered a claimable processing status';
  END IF;
  IF EXISTS (SELECT 1 FROM staging.live_shadow_candidates WHERE publication_status <> 'PRIVATE_SHADOW_ONLY'
    OR public_image_eligible OR contact_publication_approved) THEN
    RAISE EXCEPTION 'shadow-only publication invariant failed';
  END IF;
END $test$;
