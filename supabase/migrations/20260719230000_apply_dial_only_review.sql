-- Field-scoped dial promotion. Reviewing a dial must never promote unrelated
-- price, currency, condition, intent, or reference proposals from the same row.

CREATE OR REPLACE FUNCTION public.apply_dial_only_review_decision(
  p_source_record_id TEXT,
  p_operator_id TEXT,
  p_reason TEXT,
  p_catalog_confirmation JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shadow public.normalization_shadow_v4;
  v_watch public.watch_records;
  v_candidate JSONB;
  v_dial TEXT;
  v_decision_id UUID;
  v_promotion_id UUID;
  v_remaining_flags TEXT[];
  v_next_status TEXT;
  v_prior JSONB;
  v_promoted JSONB;
BEGIN
  IF COALESCE(NULLIF(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;

  SELECT * INTO v_shadow
  FROM public.normalization_shadow_v4
  WHERE source_record_id = p_source_record_id
  FOR UPDATE;

  IF NOT FOUND OR v_shadow.review_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending shadow proposal not found';
  END IF;

  IF v_shadow.candidate_count <> 1
    OR NOT ('DIAL_CHANGED' = ANY(v_shadow.change_flags))
    OR v_shadow.change_flags && ARRAY['BUNDLE_SPLIT_REQUIRED', 'NO_CANDIDATE', 'DIAL_AMBIGUOUS'] THEN
    RAISE EXCEPTION 'Proposal does not meet dial-only policy';
  END IF;

  IF COALESCE((p_catalog_confirmation ->> 'confirmed')::boolean, false) IS NOT TRUE
    OR COALESCE((p_catalog_confirmation ->> 'dialConfirmed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Catalog-confirmed dial evidence is required';
  END IF;

  v_candidate := v_shadow.proposed_candidates -> 0;
  v_dial := NULLIF(trim(v_candidate ->> 'dial_color'), '');
  IF v_dial IS NULL THEN RAISE EXCEPTION 'Proposed dial is required'; END IF;

  SELECT * INTO v_watch
  FROM public.watch_records
  WHERE id = p_source_record_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source watch record not found'; END IF;

  IF upper(COALESCE(trim(v_watch.dial_color), '')) NOT IN ('', 'UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-', '--') THEN
    RAISE EXCEPTION 'Existing dial is no longer unresolved';
  END IF;

  INSERT INTO public.normalization_review_decisions (
    source_record_id, normalization_version, decision, operator_id, reason,
    catalog_confirmation, proposed_candidate, prior_review_status
  ) VALUES (
    v_shadow.source_record_id, v_shadow.normalization_version, 'APPROVED',
    p_operator_id, p_reason,
    p_catalog_confirmation || jsonb_build_object('scope', 'DIAL_ONLY'),
    jsonb_build_object('dial_color', v_dial), v_shadow.review_status
  ) RETURNING id INTO v_decision_id;

  v_prior := to_jsonb(v_watch);

  UPDATE public.watch_records
  SET dial_color = v_dial,
      human_edited = TRUE,
      edit_source = 'human_review:dial_only:' || p_operator_id,
      review_reason = p_reason,
      reprocessed_at = now()
  WHERE id = p_source_record_id
  RETURNING to_jsonb(watch_records.*) INTO v_promoted;

  INSERT INTO public.normalization_promotion_audit (
    source_record_id, review_decision_id, operator_id, reason,
    normalization_version, prior_values, promoted_values
  ) VALUES (
    p_source_record_id, v_decision_id, p_operator_id, p_reason,
    v_shadow.normalization_version, v_prior, v_promoted
  ) RETURNING id INTO v_promotion_id;

  v_remaining_flags := array_remove(v_shadow.change_flags, 'DIAL_CHANGED');
  v_next_status := CASE WHEN cardinality(v_remaining_flags) = 0 THEN 'APPROVED' ELSE 'PENDING' END;

  UPDATE public.normalization_shadow_v4
  SET change_flags = v_remaining_flags,
      source_dial_color = v_dial,
      review_status = v_next_status
  WHERE source_record_id = p_source_record_id;

  RETURN jsonb_build_object(
    'review_decision_id', v_decision_id,
    'promotion_audit_id', v_promotion_id,
    'source_record_id', p_source_record_id,
    'dial_color', v_dial,
    'review_status', v_next_status,
    'remaining_flags', v_remaining_flags,
    'published_scope', 'DIAL_ONLY'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_dial_only_review_decision(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_dial_only_review_decision(TEXT, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
