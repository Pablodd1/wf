-- Immutable reviewer decisions for normalization shadow proposals.
-- This migration never updates public.watch_records.

CREATE TABLE IF NOT EXISTS public.normalization_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE CASCADE,
  normalization_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  operator_id TEXT NOT NULL,
  reason TEXT,
  catalog_confirmation JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_candidate JSONB,
  prior_review_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_review_decisions_source
  ON public.normalization_review_decisions (source_record_id, created_at DESC);

ALTER TABLE public.normalization_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_review_decisions FROM anon, authenticated;
GRANT ALL ON public.normalization_review_decisions TO service_role;

CREATE OR REPLACE FUNCTION public.apply_shadow_review_decision(
  p_source_record_id TEXT,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT DEFAULT NULL,
  p_catalog_confirmation JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shadow public.normalization_shadow_v4;
  v_next_status TEXT;
  v_audit_id UUID;
BEGIN
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported review decision';
  END IF;
  IF COALESCE(NULLIF(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;

  SELECT * INTO v_shadow
  FROM public.normalization_shadow_v4
  WHERE source_record_id = p_source_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shadow proposal not found';
  END IF;
  IF v_shadow.review_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Shadow proposal is not pending review';
  END IF;

  IF p_decision = 'APPROVED' THEN
    IF v_shadow.candidate_count <> 1
      OR v_shadow.change_flags && ARRAY['BUNDLE_SPLIT_REQUIRED', 'NO_CANDIDATE', 'CURRENCY_AMBIGUOUS', 'PRICE_PARSE_FAILED']
      OR COALESCE((p_catalog_confirmation ->> 'confirmed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Proposal does not meet approval policy';
    END IF;
    v_next_status := 'APPROVED';
  ELSE
    v_next_status := 'REJECTED';
  END IF;

  INSERT INTO public.normalization_review_decisions (
    source_record_id,
    normalization_version,
    decision,
    operator_id,
    reason,
    catalog_confirmation,
    proposed_candidate,
    prior_review_status
  ) VALUES (
    v_shadow.source_record_id,
    v_shadow.normalization_version,
    p_decision,
    p_operator_id,
    p_reason,
    p_catalog_confirmation,
    CASE WHEN v_shadow.candidate_count = 1 THEN v_shadow.proposed_candidates -> 0 ELSE NULL END,
    v_shadow.review_status
  ) RETURNING id INTO v_audit_id;

  UPDATE public.normalization_shadow_v4
  SET review_status = v_next_status
  WHERE source_record_id = v_shadow.source_record_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'source_record_id', v_shadow.source_record_id,
    'review_status', v_next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_shadow_review_decision(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_shadow_review_decision(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
