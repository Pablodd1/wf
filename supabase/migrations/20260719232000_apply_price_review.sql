-- Field-scoped price promotion for the bounded, human-reviewed canary ledger.

CREATE OR REPLACE FUNCTION public.apply_price_review_decision(
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
  v_watch public.watch_records;
  v_decision_id UUID;
  v_promotion_id UUID;
  v_prior JSONB;
  v_promoted JSONB;
BEGIN
  IF COALESCE(NULLIF(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;

  SELECT * INTO v_review
  FROM public.price_remediation_review
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND OR v_review.review_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending price review not found';
  END IF;

  IF v_review.normalization_reason NOT IN (
    'EXPLICIT_HKD_FROM_REFERENCE_LINE',
    'EXPLICIT_USD_FROM_REFERENCE_LINE'
  ) OR v_review.proposed_price_usd < 500 THEN
    RAISE EXCEPTION 'Price proposal does not meet canary policy';
  END IF;

  SELECT * INTO v_watch
  FROM public.watch_records
  WHERE id = v_review.source_record_id
  FOR UPDATE;

  IF NOT FOUND OR upper(COALESCE(v_watch.listing_type, '')) <> 'WTS' THEN
    RAISE EXCEPTION 'Source WTS record not found';
  END IF;
  IF v_watch.price_usd IS DISTINCT FROM v_review.stored_price_usd THEN
    RAISE EXCEPTION 'Stored price changed after review staging';
  END IF;
  IF COALESCE(NULLIF(trim(v_review.evidence_line), ''), '') = '' THEN
    RAISE EXCEPTION 'Preserved reference-line evidence is required';
  END IF;

  INSERT INTO public.normalization_review_decisions (
    source_record_id, normalization_version, decision, operator_id, reason,
    catalog_confirmation, proposed_candidate, prior_review_status
  ) VALUES (
    v_review.source_record_id, v_review.normalization_version, 'APPROVED',
    p_operator_id, p_reason,
    jsonb_build_object('scope', 'PRICE_ONLY', 'rawEvidenceConfirmed', true),
    jsonb_build_object('price_usd', v_review.proposed_price_usd), v_review.review_status
  ) RETURNING id INTO v_decision_id;

  v_prior := to_jsonb(v_watch);
  UPDATE public.watch_records
  SET price_usd = v_review.proposed_price_usd,
      human_edited = TRUE,
      edit_source = 'human_review:price_only:' || p_operator_id,
      review_reason = p_reason,
      reprocessed_at = now()
  WHERE id = v_review.source_record_id
  RETURNING to_jsonb(watch_records.*) INTO v_promoted;

  INSERT INTO public.normalization_promotion_audit (
    source_record_id, review_decision_id, operator_id, reason,
    normalization_version, prior_values, promoted_values
  ) VALUES (
    v_review.source_record_id, v_decision_id, p_operator_id, p_reason,
    v_review.normalization_version, v_prior, v_promoted
  ) RETURNING id INTO v_promotion_id;

  UPDATE public.price_remediation_review
  SET review_status = 'APPLIED', reviewed_by = p_operator_id,
      reviewed_at = now(), applied_at = now(), updated_at = now()
  WHERE id = p_review_id;

  RETURN jsonb_build_object(
    'review_id', p_review_id,
    'source_record_id', v_review.source_record_id,
    'price_usd', v_review.proposed_price_usd,
    'promotion_audit_id', v_promotion_id,
    'published_scope', 'PRICE_ONLY'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_price_review_decision(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_price_review_decision(BIGINT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
