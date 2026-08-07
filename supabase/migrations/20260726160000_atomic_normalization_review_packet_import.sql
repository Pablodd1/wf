-- Atomic, service-only import for one already-generated immutable review packet.
-- This migration never writes public.watch_records.

CREATE OR REPLACE FUNCTION public.normalization_review_canonical_json(
  p_value JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_result TEXT;
BEGIN
  CASE pg_catalog.jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(pg_catalog.string_agg(
        pg_catalog.to_jsonb(entry.key)::TEXT || ':' ||
          public.normalization_review_canonical_json(entry.value),
        ',' ORDER BY entry.key COLLATE "C"
      ), '') || '}'
      INTO v_result
      FROM pg_catalog.jsonb_each(p_value) AS entry;
      RETURN v_result;
    WHEN 'array' THEN
      SELECT '[' || COALESCE(pg_catalog.string_agg(
        public.normalization_review_canonical_json(element.value),
        ',' ORDER BY element.ordinal
      ), '') || ']'
      INTO v_result
      FROM pg_catalog.jsonb_array_elements(p_value)
        WITH ORDINALITY AS element(value, ordinal);
      RETURN v_result;
    ELSE
      RETURN p_value::TEXT;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalization_review_has_private_key(
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_key TEXT;
  v_child JSONB;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN
      SELECT entry.key, entry.value
      FROM pg_catalog.jsonb_each(p_value) AS entry
    LOOP
      IF (
        v_key ~* '^(raw_message|raw_line)$'
        OR v_key ~* '(^|_)(seller|phone|contact|email|observed_name|source_identity)($|_)'
      ) THEN
        RETURN true;
      END IF;
      IF public.normalization_review_has_private_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN
      SELECT element.value
      FROM pg_catalog.jsonb_array_elements(p_value) AS element
    LOOP
      IF public.normalization_review_has_private_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_normalization_review_packet(
  p_packet JSONB,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_item_count INTEGER;
  v_packet_id TEXT;
  v_packet_version TEXT;
  v_current_raw_message TEXT;
  v_expected_item_id TEXT;
  v_stored_packet JSONB;
  v_stored_items JSONB;
  v_supplied_items JSONB;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_packet IS NULL
    OR pg_catalog.jsonb_typeof(p_packet) <> 'object'
    OR pg_catalog.jsonb_object_length(p_packet) <> 6
    OR NOT p_packet ?& ARRAY[
      'id', 'reason', 'normalization_version', 'source_artifact_sha256',
      'status', 'item_count'
    ]
    OR p_packet - ARRAY[
      'id', 'reason', 'normalization_version', 'source_artifact_sha256',
      'status', 'item_count'
    ] <> '{}'::JSONB THEN
    RAISE EXCEPTION 'INVALID_PACKET_HEADER';
  END IF;
  IF pg_catalog.jsonb_typeof(p_packet -> 'id') <> 'string'
    OR (p_packet ->> 'id') !~ '^rp_[a-z0-9_]{1,280}$'
    OR pg_catalog.jsonb_typeof(p_packet -> 'reason') <> 'string'
    OR (p_packet ->> 'reason') !~ '^[A-Z][A-Z0-9_]{1,79}$'
    OR pg_catalog.jsonb_typeof(p_packet -> 'normalization_version') <> 'string'
    OR pg_catalog.length(p_packet ->> 'normalization_version') NOT BETWEEN 1 AND 120
    OR pg_catalog.jsonb_typeof(p_packet -> 'source_artifact_sha256') <> 'string'
    OR (p_packet ->> 'source_artifact_sha256') !~ '^[a-f0-9]{64}$'
    OR p_packet ->> 'status' <> 'READY_FOR_REVIEW'
    OR pg_catalog.jsonb_typeof(p_packet -> 'item_count') <> 'number'
    OR (p_packet ->> 'item_count')::NUMERIC <>
      pg_catalog.trunc((p_packet ->> 'item_count')::NUMERIC)
    OR (p_packet ->> 'item_count')::NUMERIC NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'INVALID_PACKET_HEADER';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PACKET_ITEMS';
  END IF;

  v_packet_id := p_packet ->> 'id';
  v_packet_version := p_packet ->> 'normalization_version';
  IF v_packet_id !~ (
    '^rp_' ||
    pg_catalog.left(p_packet ->> 'source_artifact_sha256', 12) || '_' ||
    pg_catalog.lower(p_packet ->> 'reason') || '_[0-9]{4,6}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_PACKET_ID';
  END IF;
  v_item_count := pg_catalog.jsonb_array_length(p_items);
  IF v_item_count <> (p_packet ->> 'item_count')::INTEGER
    OR v_item_count NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'PACKET_ITEM_COUNT_MISMATCH';
  END IF;

  FOR v_item IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(p_items) AS element
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR pg_catalog.jsonb_object_length(v_item) <> 9
      OR NOT v_item ?& ARRAY[
        'id', 'packet_id', 'ordinal', 'source_record_id',
        'normalization_version', 'frozen_proposal', 'proposal_sha256',
        'raw_message_sha256', 'status'
      ]
      OR v_item - ARRAY[
        'id', 'packet_id', 'ordinal', 'source_record_id',
        'normalization_version', 'frozen_proposal', 'proposal_sha256',
        'raw_message_sha256', 'status'
      ] <> '{}'::JSONB THEN
      RAISE EXCEPTION 'INVALID_PACKET_ITEM';
    END IF;
    IF pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
      OR (v_item ->> 'id') !~ '^ri_[a-f0-9]{40}$'
      OR v_item ->> 'packet_id' <> v_packet_id
      OR pg_catalog.jsonb_typeof(v_item -> 'ordinal') <> 'number'
      OR (v_item ->> 'ordinal')::NUMERIC <>
        pg_catalog.trunc((v_item ->> 'ordinal')::NUMERIC)
      OR (v_item ->> 'ordinal')::NUMERIC NOT BETWEEN 1 AND v_item_count
      OR pg_catalog.jsonb_typeof(v_item -> 'source_record_id') <> 'string'
      OR pg_catalog.length(v_item ->> 'source_record_id') NOT BETWEEN 1 AND 300
      OR v_item ->> 'normalization_version' <> v_packet_version
      OR pg_catalog.jsonb_typeof(v_item -> 'frozen_proposal') <> 'object'
      OR (v_item ->> 'proposal_sha256') !~ '^[a-f0-9]{64}$'
      OR (v_item ->> 'raw_message_sha256') !~ '^[a-f0-9]{64}$'
      OR v_item ->> 'status' <> 'PENDING' THEN
      RAISE EXCEPTION 'INVALID_PACKET_ITEM';
    END IF;
    IF public.normalization_review_has_private_key(v_item -> 'frozen_proposal') THEN
      RAISE EXCEPTION 'PRIVATE_EVIDENCE_NOT_ALLOWED';
    END IF;
    IF pg_catalog.jsonb_typeof(v_item #> '{frozen_proposal,candidate_count}') <> 'number'
      OR (v_item #>> '{frozen_proposal,candidate_count}')::NUMERIC <>
        pg_catalog.trunc((v_item #>> '{frozen_proposal,candidate_count}')::NUMERIC)
      OR (v_item #>> '{frozen_proposal,candidate_count}')::NUMERIC < 0
      OR pg_catalog.jsonb_typeof(v_item #> '{frozen_proposal,proposed_candidates}') <> 'array'
      OR pg_catalog.jsonb_typeof(v_item #> '{frozen_proposal,change_flags}') <> 'array'
      OR (v_item #>> '{frozen_proposal,candidate_count}')::INTEGER <>
        pg_catalog.jsonb_array_length(v_item #> '{frozen_proposal,proposed_candidates}') THEN
      RAISE EXCEPTION 'INVALID_FROZEN_PROPOSAL';
    END IF;
    IF (
      CASE
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'NO_CANDIDATE'
          THEN 'NO_CANDIDATE'
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'CURRENCY_AMBIGUOUS'
          THEN 'CURRENCY_AMBIGUOUS'
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'EMOJI_PRICE_AMBIGUOUS'
          THEN 'EMOJI_PRICE_AMBIGUOUS'
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'PRICE_PARSE_FAILED'
          THEN 'PRICE_PARSE_FAILED'
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'DIAL_AMBIGUOUS'
          THEN 'DIAL_AMBIGUOUS'
        WHEN (v_item #> '{frozen_proposal,change_flags}') ? 'BUNDLE_SPLIT_REQUIRED'
          THEN 'BUNDLE_SPLIT_REQUIRED'
        ELSE 'DETERMINISTIC_CHANGE_REVIEW'
      END
    ) <> p_packet ->> 'reason' THEN
      RAISE EXCEPTION 'PACKET_REASON_MISMATCH';
    END IF;
    IF (
      p_packet ->> 'reason' = 'NO_CANDIDATE'
      AND (v_item #>> '{frozen_proposal,candidate_count}')::INTEGER <> 0
    ) OR (
      p_packet ->> 'reason' = 'BUNDLE_SPLIT_REQUIRED'
      AND (v_item #>> '{frozen_proposal,candidate_count}')::INTEGER <= 1
    ) OR (
      p_packet ->> 'reason' NOT IN ('NO_CANDIDATE', 'BUNDLE_SPLIT_REQUIRED')
      AND (v_item #>> '{frozen_proposal,candidate_count}')::INTEGER <> 1
    ) THEN
      RAISE EXCEPTION 'CANDIDATE_COUNT_REASON_MISMATCH';
    END IF;
    v_expected_item_id := 'ri_' || pg_catalog.left(
      pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            v_packet_id || '|' ||
            (v_item ->> 'ordinal') || '|' ||
            (v_item ->> 'source_record_id') || '|' ||
            (v_item ->> 'normalization_version'),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      40
    );
    IF v_item ->> 'id' <> v_expected_item_id THEN
      RAISE EXCEPTION 'PACKET_ITEM_ID_MISMATCH';
    END IF;
    IF pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          public.normalization_review_canonical_json(v_item -> 'frozen_proposal'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) <> v_item ->> 'proposal_sha256' THEN
      RAISE EXCEPTION 'PROPOSAL_HASH_MISMATCH';
    END IF;

    SELECT source.raw_message
    INTO v_current_raw_message
    FROM public.watch_records AS source
    WHERE source.id = v_item ->> 'source_record_id'
    FOR SHARE OF source;
    IF NOT FOUND
      OR v_current_raw_message IS NULL
      OR pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(v_current_raw_message, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) <> v_item ->> 'raw_message_sha256' THEN
      RAISE EXCEPTION 'STALE_SOURCE_EVIDENCE';
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(DISTINCT (element.value ->> 'ordinal')::INTEGER)
    FROM pg_catalog.jsonb_array_elements(p_items) AS element
  ) <> v_item_count
    OR (
      SELECT pg_catalog.count(DISTINCT (
        element.value ->> 'source_record_id',
        element.value ->> 'normalization_version'
      ))
      FROM pg_catalog.jsonb_array_elements(p_items) AS element
    ) <> v_item_count
    OR (
      SELECT pg_catalog.count(DISTINCT element.value ->> 'id')
      FROM pg_catalog.jsonb_array_elements(p_items) AS element
    ) <> v_item_count THEN
    RAISE EXCEPTION 'DUPLICATE_PACKET_ITEM';
  END IF;

  BEGIN
    INSERT INTO public.normalization_review_packets (
      id,
      reason,
      normalization_version,
      source_artifact_sha256,
      status,
      item_count
    ) VALUES (
      v_packet_id,
      p_packet ->> 'reason',
      v_packet_version,
      p_packet ->> 'source_artifact_sha256',
      p_packet ->> 'status',
      v_item_count
    );

    INSERT INTO public.normalization_review_packet_items (
      id,
      packet_id,
      ordinal,
      source_record_id,
      normalization_version,
      frozen_proposal,
      proposal_sha256,
      raw_message_sha256,
      status
    )
    SELECT
      element.value ->> 'id',
      element.value ->> 'packet_id',
      (element.value ->> 'ordinal')::INTEGER,
      element.value ->> 'source_record_id',
      element.value ->> 'normalization_version',
      element.value -> 'frozen_proposal',
      element.value ->> 'proposal_sha256',
      element.value ->> 'raw_message_sha256',
      element.value ->> 'status'
    FROM pg_catalog.jsonb_array_elements(p_items) AS element;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  SELECT pg_catalog.to_jsonb(packet) - 'created_at'
  INTO v_stored_packet
  FROM public.normalization_review_packets AS packet
  WHERE packet.id = v_packet_id;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(item) - 'created_at'
    ORDER BY item.ordinal
  )
  INTO v_stored_items
  FROM public.normalization_review_packet_items AS item
  WHERE item.packet_id = v_packet_id;

  SELECT pg_catalog.jsonb_agg(element.value ORDER BY (element.value ->> 'ordinal')::INTEGER)
  INTO v_supplied_items
  FROM pg_catalog.jsonb_array_elements(p_items) AS element;

  IF v_stored_packet IS DISTINCT FROM p_packet
    OR v_stored_items IS DISTINCT FROM v_supplied_items THEN
    RAISE EXCEPTION 'PACKET_RETRY_CONTENT_MISMATCH';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'packet_id', v_packet_id,
    'item_count', v_item_count,
    'exact_match', true,
    'watch_records_mutated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalization_review_canonical_json(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.normalization_review_has_private_key(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_normalization_review_packet(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_normalization_review_packet(JSONB, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.import_normalization_review_packet(JSONB, JSONB) IS
  'Atomically inserts one immutable private review packet and <=500 exact items; exact duplicate retries only; never writes watch_records.';

NOTIFY pgrst, 'reload schema';
