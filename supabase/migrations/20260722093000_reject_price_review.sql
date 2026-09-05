-- A rejected price proposal must have the same durable audit trail as an
-- applied proposal, while leaving the source market record unchanged.

CREATE OR REPLACE FUNCTION public.reject_price_review_decision(
  p_review_id BIGINT,
  p_operator_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.price_remediation_review;
  v_decision_id UUID;
BEGIN
  IF COALESCE(NULLIF(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;
  IF COALESCE(NULLIF(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'rejection reason is required';
  END IF;

  SELECT * INTO v_review
  FROM public.price_remediation_review
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND OR v_review.review_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending price review not found';
  END IF;

  INSERT INTO public.normalization_review_decisions (
    source_record_id, normalization_version, decision, operator_id, reason,
    catalog_confirmation, proposed_candidate, prior_review_status
  ) VALUES (
    v_review.source_record_id, v_review.normalization_version, 'REJECTED',
    p_operator_id, p_reason,
    jsonb_build_object('scope', 'PRICE_ONLY', 'rawEvidenceConfirmed', false),
    jsonb_build_object('price_usd', v_review.proposed_price_usd), v_review.review_status
  ) RETURNING id INTO v_decision_id;

  UPDATE public.price_remediation_review
  SET review_status = 'REJECTED', reviewed_by = p_operator_id,
      reviewed_at = now(), updated_at = now()
  WHERE id = p_review_id;

  RETURN jsonb_build_object(
    'review_id', p_review_id,
    'source_record_id', v_review.source_record_id,
    'review_status', 'REJECTED',
    'watch_records_mutated', false,
    'audit_id', v_decision_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_price_review_decision(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_price_review_decision(BIGINT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
