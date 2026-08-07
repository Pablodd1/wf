-- Reversible duplicate-review ledger.
-- This migration never deletes raw messages or watch_records. A reviewer can
-- suppress a confirmed repost from analytics while preserving both observations.

CREATE TABLE IF NOT EXISTS public.duplicate_review_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE RESTRICT,
  duplicate_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE RESTRICT,
  match_type TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  suppress_from_analytics BOOLEAN NOT NULL DEFAULT false,
  bundle_risk BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SUPPRESSED', 'KEEP_BOTH', 'DEFERRED')),
  reviewer_id TEXT,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT duplicate_review_candidates_distinct_ids CHECK (canonical_id <> duplicate_id),
  CONSTRAINT duplicate_review_candidates_unique_pair UNIQUE (canonical_id, duplicate_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_review_candidates_queue
  ON public.duplicate_review_candidates (status, confidence DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_duplicate_review_candidates_duplicate
  ON public.duplicate_review_candidates (duplicate_id, status);

ALTER TABLE public.duplicate_review_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duplicate_review_candidates FROM anon, authenticated;
GRANT ALL ON public.duplicate_review_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.apply_duplicate_review_decision(
  p_candidate_id UUID,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.duplicate_review_candidates;
  v_decision TEXT := upper(trim(coalesce(p_decision, '')));
  v_status TEXT;
BEGIN
  IF v_decision NOT IN ('SUPPRESS', 'KEEP_BOTH', 'DEFER') THEN
    RAISE EXCEPTION 'Unsupported duplicate review decision';
  END IF;
  IF coalesce(nullif(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;
  IF coalesce(nullif(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'A duplicate review reason is required';
  END IF;

  SELECT * INTO v_candidate
  FROM public.duplicate_review_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND OR v_candidate.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Duplicate candidate is not pending review';
  END IF;

  v_status := CASE v_decision
    WHEN 'SUPPRESS' THEN 'SUPPRESSED'
    WHEN 'KEEP_BOTH' THEN 'KEEP_BOTH'
    ELSE 'DEFERRED'
  END;

  UPDATE public.duplicate_review_candidates
  SET status = v_status,
      suppress_from_analytics = v_decision = 'SUPPRESS',
      reviewer_id = p_operator_id,
      review_reason = p_reason,
      reviewed_at = now()
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'candidate_id', p_candidate_id,
    'decision', v_decision,
    'status', v_status,
    'raw_evidence_preserved', true,
    'watch_records_deleted', false,
    'analytics_suppressed', v_decision = 'SUPPRESS'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_duplicate_review_decision(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_review_decision(UUID, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
