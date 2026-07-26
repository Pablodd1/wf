-- Append-only evidence for an administrator restoring a reviewed suppression.
-- Source evidence and watch_records remain unchanged.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.duplicate_review_decision_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id UUID NOT NULL
    REFERENCES public.duplicate_review_candidates(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision = 'RESTORE_KEEP_BOTH'),
  prior_status TEXT NOT NULL CHECK (prior_status = 'SUPPRESSED'),
  new_status TEXT NOT NULL CHECK (new_status = 'KEEP_BOTH'),
  prior_decision_evidence JSONB NOT NULL CHECK (
    jsonb_typeof(prior_decision_evidence) = 'object'
    AND prior_decision_evidence <> '{}'::jsonb
  ),
  operator_id TEXT NOT NULL CHECK (length(trim(operator_id)) BETWEEN 1 AND 320),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duplicate_review_decision_events_candidate
  ON public.duplicate_review_decision_events (candidate_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_duplicate_review_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Duplicate review decision events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS duplicate_review_decision_events_immutable
  ON public.duplicate_review_decision_events;
CREATE TRIGGER duplicate_review_decision_events_immutable
BEFORE UPDATE OR DELETE ON public.duplicate_review_decision_events
FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_review_event_mutation();

CREATE OR REPLACE FUNCTION public.restore_duplicate_review_suppression(
  p_candidate_id UUID,
  p_operator_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_candidate public.duplicate_review_candidates;
  v_event_id BIGINT;
BEGIN
  IF NULLIF(trim(COALESCE(p_operator_id, '')), '') IS NULL
    OR length(trim(p_operator_id)) > 320 THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'A restore reason of 10 to 1000 characters is required';
  END IF;

  SELECT *
  INTO v_candidate
  FROM public.duplicate_review_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND OR v_candidate.status <> 'SUPPRESSED' THEN
    RAISE EXCEPTION 'Duplicate candidate is not suppressed';
  END IF;

  INSERT INTO public.duplicate_review_decision_events (
    candidate_id,
    decision,
    prior_status,
    new_status,
    prior_decision_evidence,
    operator_id,
    reason
  ) VALUES (
    v_candidate.id,
    'RESTORE_KEEP_BOTH',
    v_candidate.status,
    'KEEP_BOTH',
    jsonb_build_object(
      'canonical_id', v_candidate.canonical_id,
      'duplicate_id', v_candidate.duplicate_id,
      'match_type', v_candidate.match_type,
      'confidence', v_candidate.confidence,
      'bundle_risk', v_candidate.bundle_risk,
      'evidence', v_candidate.evidence,
      'reviewer_id', v_candidate.reviewer_id,
      'review_reason', v_candidate.review_reason,
      'reviewed_at', v_candidate.reviewed_at,
      'suppress_from_analytics', v_candidate.suppress_from_analytics
    ),
    trim(p_operator_id),
    trim(p_reason)
  )
  RETURNING id INTO v_event_id;

  UPDATE public.duplicate_review_candidates
  SET status = 'KEEP_BOTH',
      suppress_from_analytics = FALSE,
      reviewer_id = trim(p_operator_id),
      review_reason = trim(p_reason),
      reviewed_at = now()
  WHERE id = v_candidate.id;

  RETURN jsonb_build_object(
    'candidate_id', v_candidate.id,
    'event_id', v_event_id,
    'decision', 'RESTORE_KEEP_BOTH',
    'status', 'KEEP_BOTH',
    'raw_evidence_preserved', TRUE,
    'watch_records_deleted', FALSE,
    'analytics_suppressed', FALSE
  );
END;
$$;

ALTER TABLE public.duplicate_review_decision_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duplicate_review_decision_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.duplicate_review_decision_events TO service_role;

REVOKE ALL ON FUNCTION public.restore_duplicate_review_suppression(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_duplicate_review_suppression(UUID, TEXT, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.reject_duplicate_review_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.duplicate_review_decision_events IS
  'Private append-only evidence for reviewed duplicate decision reversals.';
COMMENT ON FUNCTION public.restore_duplicate_review_suppression(UUID, TEXT, TEXT) IS
  'Service-only audited restoration from SUPPRESSED to KEEP_BOTH; never deletes or changes watch_records.';

NOTIFY pgrst, 'reload schema';
COMMIT;
