-- Private, immutable review packets for bounded human correction work.
-- This migration does not promote or mutate public.watch_records.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.normalization_review_packets (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  normalization_version TEXT NOT NULL,
  source_artifact_sha256 TEXT NOT NULL CHECK (source_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'READY_FOR_REVIEW'
    CHECK (status = 'READY_FOR_REVIEW'),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, normalization_version)
);

CREATE TABLE IF NOT EXISTS public.normalization_review_packet_items (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
  source_record_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE RESTRICT,
  normalization_version TEXT NOT NULL,
  frozen_proposal JSONB NOT NULL CHECK (jsonb_typeof(frozen_proposal) = 'object'),
  proposal_sha256 TEXT NOT NULL CHECK (proposal_sha256 ~ '^[a-f0-9]{64}$'),
  raw_message_sha256 TEXT NOT NULL CHECK (raw_message_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status = 'PENDING'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT normalization_review_packet_items_packet_version_fkey
    FOREIGN KEY (packet_id, normalization_version)
    REFERENCES public.normalization_review_packets(id, normalization_version)
    ON DELETE RESTRICT,
  UNIQUE (packet_id, ordinal),
  UNIQUE (source_record_id, normalization_version)
);

CREATE TABLE IF NOT EXISTS public.normalization_review_packet_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  packet_item_id TEXT NOT NULL UNIQUE
    REFERENCES public.normalization_review_packet_items(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision = 'CORRECTION_PROPOSED'),
  correction_fields JSONB NOT NULL CHECK (
    jsonb_typeof(correction_fields) = 'object'
    AND correction_fields <> '{}'::jsonb
  ),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 10 AND 2000),
  expected_raw_sha256 TEXT NOT NULL CHECK (expected_raw_sha256 ~ '^[a-f0-9]{64}$'),
  expected_proposal_sha256 TEXT NOT NULL CHECK (expected_proposal_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_hashes TEXT[] NOT NULL CHECK (cardinality(evidence_hashes) BETWEEN 2 AND 10),
  reviewer_id UUID NOT NULL,
  reviewer_email TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('reviewer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_review_packet_decisions_reviewer
  ON public.normalization_review_packet_decisions (reviewer_id, created_at DESC);

CREATE OR REPLACE VIEW public.normalization_review_packet_item_compact
WITH (security_invoker = true)
AS
SELECT
  item.id,
  item.packet_id,
  item.ordinal,
  item.source_record_id,
  item.normalization_version,
  item.status,
  item.proposal_sha256,
  item.raw_message_sha256,
  jsonb_build_object(
    'candidateCount', item.frozen_proposal -> 'candidate_count',
    'brand', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,brand}',
      item.frozen_proposal #>> '{candidate,brand}',
      item.frozen_proposal ->> 'brand'
    ),
    'reference', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,reference}',
      item.frozen_proposal #>> '{candidate,reference}',
      item.frozen_proposal ->> 'reference'
    ),
    'dialColor', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,dial_color}',
      item.frozen_proposal #>> '{candidate,dial_color}',
      item.frozen_proposal ->> 'dial_color'
    ),
    'condition', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,condition}',
      item.frozen_proposal #>> '{candidate,condition}',
      item.frozen_proposal ->> 'condition'
    ),
    'year', COALESCE(
      item.frozen_proposal #> '{proposed_candidates,0,year}',
      item.frozen_proposal #> '{candidate,year}',
      item.frozen_proposal -> 'year'
    ),
    'priceRaw', COALESCE(
      item.frozen_proposal #> '{proposed_candidates,0,price_raw}',
      item.frozen_proposal #> '{candidate,price_raw}',
      item.frozen_proposal -> 'price_raw'
    ),
    'priceUsd', COALESCE(
      item.frozen_proposal #> '{proposed_candidates,0,price_usd}',
      item.frozen_proposal #> '{candidate,price_usd}',
      item.frozen_proposal -> 'price_usd'
    ),
    'currency', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,currency}',
      item.frozen_proposal #>> '{candidate,currency}',
      item.frozen_proposal ->> 'currency'
    ),
    'listingType', COALESCE(
      item.frozen_proposal #>> '{proposed_candidates,0,listing_type}',
      item.frozen_proposal #>> '{candidate,listing_type}',
      item.frozen_proposal ->> 'listing_type'
    )
  ) AS proposal_summary
FROM public.normalization_review_packet_items AS item;

CREATE OR REPLACE FUNCTION public.reject_normalization_review_packet_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Normalization review packet snapshots and decisions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS normalization_review_packets_immutable
  ON public.normalization_review_packets;
CREATE TRIGGER normalization_review_packets_immutable
BEFORE UPDATE OR DELETE ON public.normalization_review_packets
FOR EACH ROW EXECUTE FUNCTION public.reject_normalization_review_packet_mutation();

DROP TRIGGER IF EXISTS normalization_review_packet_items_immutable
  ON public.normalization_review_packet_items;
CREATE TRIGGER normalization_review_packet_items_immutable
BEFORE UPDATE OR DELETE ON public.normalization_review_packet_items
FOR EACH ROW EXECUTE FUNCTION public.reject_normalization_review_packet_mutation();

DROP TRIGGER IF EXISTS normalization_review_packet_decisions_immutable
  ON public.normalization_review_packet_decisions;
CREATE TRIGGER normalization_review_packet_decisions_immutable
BEFORE UPDATE OR DELETE ON public.normalization_review_packet_decisions
FOR EACH ROW EXECUTE FUNCTION public.reject_normalization_review_packet_mutation();

CREATE OR REPLACE FUNCTION public.propose_normalization_review_correction(
  p_packet_item_id TEXT,
  p_correction_fields JSONB,
  p_rationale TEXT,
  p_expected_raw_sha256 TEXT,
  p_expected_proposal_sha256 TEXT,
  p_evidence_hashes TEXT[],
  p_reviewer_id UUID,
  p_reviewer_email TEXT,
  p_reviewer_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.normalization_review_packet_items;
  v_raw_message TEXT;
  v_current_raw_sha256 TEXT;
  v_decision_id BIGINT;
  v_created_at TIMESTAMPTZ;
BEGIN
  IF p_reviewer_id IS NULL OR p_reviewer_role NOT IN ('reviewer', 'admin') THEN
    RAISE EXCEPTION 'INVALID_REVIEWER';
  END IF;
  IF p_correction_fields IS NULL
    OR jsonb_typeof(p_correction_fields) <> 'object'
    OR p_correction_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_FIELDS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_correction_fields) AS correction_key(field_name)
    WHERE field_name NOT IN (
      'brand', 'reference', 'dial_color', 'condition', 'year',
      'price_raw', 'price_usd', 'currency', 'listing_type'
    )
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_CORRECTION_FIELD';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(p_correction_fields) AS correction(field_name, field_value)
    WHERE (
      field_name IN ('year', 'price_raw', 'price_usd')
      AND jsonb_typeof(field_value) NOT IN ('number', 'null')
    ) OR (
      field_name NOT IN ('year', 'price_raw', 'price_usd')
      AND jsonb_typeof(field_value) NOT IN ('string', 'null')
    ) OR (
      field_name NOT IN ('year', 'price_raw', 'price_usd')
      AND jsonb_typeof(field_value) = 'string'
      AND (length(trim(field_value #>> '{}')) NOT BETWEEN 1 AND 200)
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_FIELD_VALUE';
  END IF;
  IF p_correction_fields ? 'year'
    AND jsonb_typeof(p_correction_fields -> 'year') = 'number'
    AND (
      (p_correction_fields ->> 'year')::numeric <> trunc((p_correction_fields ->> 'year')::numeric)
      OR (p_correction_fields ->> 'year')::numeric NOT BETWEEN 1000 AND
        extract(year FROM CURRENT_DATE) + 1
    ) THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_YEAR';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(p_correction_fields) AS correction(field_name, field_value)
    WHERE field_name IN ('price_raw', 'price_usd')
      AND jsonb_typeof(field_value) = 'number'
      AND (field_value #>> '{}')::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_PRICE';
  END IF;
  IF length(trim(COALESCE(p_rationale, ''))) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_RATIONALE';
  END IF;
  IF COALESCE(p_expected_raw_sha256, '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(p_expected_proposal_sha256, '') !~ '^[a-f0-9]{64}$'
    OR p_evidence_hashes IS NULL
    OR cardinality(p_evidence_hashes) NOT BETWEEN 2 AND 10
    OR EXISTS (
      SELECT 1 FROM unnest(p_evidence_hashes) AS supplied_hash(evidence_hash)
      WHERE evidence_hash !~ '^[a-f0-9]{64}$'
    )
    OR NOT p_expected_raw_sha256 = ANY(p_evidence_hashes)
    OR NOT p_expected_proposal_sha256 = ANY(p_evidence_hashes) THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_HASHES';
  END IF;

  SELECT item.*
  INTO v_item
  FROM public.normalization_review_packet_items AS item
  WHERE item.id = p_packet_item_id
  FOR SHARE OF item;

  IF NOT FOUND THEN RAISE EXCEPTION 'PACKET_ITEM_NOT_FOUND'; END IF;

  SELECT source.raw_message
  INTO v_raw_message
  FROM public.watch_records AS source
  WHERE source.id = v_item.source_record_id
  FOR SHARE OF source;

  IF NOT FOUND THEN RAISE EXCEPTION 'PACKET_SOURCE_NOT_FOUND'; END IF;
  IF v_item.status <> 'PENDING'
    OR v_item.raw_message_sha256 <> p_expected_raw_sha256
    OR v_item.proposal_sha256 <> p_expected_proposal_sha256 THEN
    RAISE EXCEPTION 'STALE_PACKET_ITEM';
  END IF;

  v_current_raw_sha256 := encode(
    extensions.digest(convert_to(COALESCE(v_raw_message, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_current_raw_sha256 <> v_item.raw_message_sha256 THEN
    RAISE EXCEPTION 'STALE_SOURCE_EVIDENCE';
  END IF;

  INSERT INTO public.normalization_review_packet_decisions (
    packet_item_id,
    decision,
    correction_fields,
    rationale,
    expected_raw_sha256,
    expected_proposal_sha256,
    evidence_hashes,
    reviewer_id,
    reviewer_email,
    reviewer_role
  ) VALUES (
    v_item.id,
    'CORRECTION_PROPOSED',
    p_correction_fields,
    trim(p_rationale),
    p_expected_raw_sha256,
    p_expected_proposal_sha256,
    p_evidence_hashes,
    p_reviewer_id,
    NULLIF(trim(COALESCE(p_reviewer_email, '')), ''),
    p_reviewer_role
  )
  RETURNING id, created_at INTO v_decision_id, v_created_at;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'packet_item_id', v_item.id,
    'status', 'CORRECTION_PROPOSED',
    'created_at', v_created_at,
    'watch_records_mutated', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'CORRECTION_ALREADY_PROPOSED';
END;
$$;

ALTER TABLE public.normalization_review_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalization_review_packet_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalization_review_packet_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.normalization_review_packets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.normalization_review_packet_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.normalization_review_packet_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.normalization_review_packets TO service_role;
GRANT SELECT, INSERT ON public.normalization_review_packet_items TO service_role;
GRANT SELECT ON public.normalization_review_packet_decisions TO service_role;
REVOKE ALL ON public.normalization_review_packet_item_compact FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.normalization_review_packet_item_compact TO service_role;

REVOKE ALL ON FUNCTION public.propose_normalization_review_correction(
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_normalization_review_correction(
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.reject_normalization_review_packet_mutation()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.normalization_review_packets IS
  'Private immutable headers for bounded normalization human-review packets.';
COMMENT ON TABLE public.normalization_review_packet_items IS
  'Exclusive packet membership with frozen deterministic proposal and immutable source/proposal hashes; no contact data.';
COMMENT ON TABLE public.normalization_review_packet_decisions IS
  'Append-only reviewer correction proposals. Never a watch_records promotion path.';

NOTIFY pgrst, 'reload schema';
