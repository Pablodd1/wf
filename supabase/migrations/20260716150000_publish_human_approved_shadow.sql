-- Human approval is the production promotion boundary.
-- The transaction preserves prior values, applies one catalog-confirmed
-- candidate, caps confidence at 100, and leaves a rollback/audit record.

CREATE TABLE IF NOT EXISTS public.normalization_promotion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE RESTRICT,
  review_decision_id UUID NOT NULL REFERENCES public.normalization_review_decisions(id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL,
  reason TEXT,
  normalization_version TEXT NOT NULL,
  prior_values JSONB NOT NULL,
  promoted_values JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_promotion_audit_source
  ON public.normalization_promotion_audit (source_record_id, created_at DESC);

ALTER TABLE public.normalization_promotion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_promotion_audit FROM anon, authenticated;
GRANT ALL ON public.normalization_promotion_audit TO service_role;

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
  v_watch public.watch_records;
  v_candidate JSONB;
  v_next_status TEXT;
  v_decision_id UUID;
  v_promotion_id UUID;
  v_prior JSONB;
  v_promoted JSONB;
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
  IF NOT FOUND OR v_shadow.review_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending shadow proposal not found';
  END IF;

  SELECT * INTO v_watch
  FROM public.watch_records
  WHERE id = p_source_record_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source watch record not found'; END IF;

  v_candidate := CASE WHEN v_shadow.candidate_count = 1 THEN v_shadow.proposed_candidates -> 0 ELSE NULL END;
  IF p_decision = 'APPROVED' THEN
    IF v_candidate IS NULL
      OR v_shadow.change_flags && ARRAY['BUNDLE_SPLIT_REQUIRED', 'NO_CANDIDATE', 'CURRENCY_AMBIGUOUS', 'PRICE_PARSE_FAILED', 'DIAL_AMBIGUOUS']
      OR COALESCE((p_catalog_confirmation ->> 'confirmed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Proposal does not meet approval policy';
    END IF;
    v_next_status := 'APPROVED';
  ELSE
    v_next_status := 'REJECTED';
  END IF;

  INSERT INTO public.normalization_review_decisions (
    source_record_id, normalization_version, decision, operator_id, reason,
    catalog_confirmation, proposed_candidate, prior_review_status
  ) VALUES (
    v_shadow.source_record_id, v_shadow.normalization_version, p_decision,
    p_operator_id, p_reason, p_catalog_confirmation, v_candidate, v_shadow.review_status
  ) RETURNING id INTO v_decision_id;

  IF p_decision = 'APPROVED' THEN
    v_prior := jsonb_build_object(
      'brand', v_watch.brand, 'reference', v_watch.reference, 'dial_color', v_watch.dial_color,
      'condition', v_watch.condition, 'price_raw', v_watch.price_raw,
      'price_usd', v_watch.price_usd, 'currency', v_watch.currency,
      'listing_type', v_watch.listing_type, 'listing_status', v_watch.listing_status,
      'verdict', v_watch.verdict, 'confidence', v_watch.confidence,
      'parser_version', v_watch.parser_version, 'human_edited', v_watch.human_edited,
      'edit_source', v_watch.edit_source
    );

    UPDATE public.watch_records
    SET brand = COALESCE(NULLIF(v_candidate ->> 'brand', ''), brand),
        reference = COALESCE(NULLIF(v_candidate ->> 'reference', ''), reference),
        dial_color = COALESCE(NULLIF(v_candidate ->> 'dial_color', ''), dial_color),
        condition = COALESCE(NULLIF(v_candidate ->> 'condition', ''), condition),
        price_raw = COALESCE(NULLIF(v_candidate ->> 'price_raw', '')::numeric, price_raw),
        price_usd = COALESCE(NULLIF(v_candidate ->> 'price_usd', '')::numeric, price_usd),
        currency = COALESCE(NULLIF(v_candidate ->> 'currency', ''), currency),
        listing_type = COALESCE(NULLIF(v_candidate ->> 'listing_type', ''), listing_type),
        listing_status = COALESCE(NULLIF(v_candidate ->> 'listing_status', ''), listing_status),
        verdict = 'APPROVED',
        confidence = 100,
        human_edited = TRUE,
        edit_source = 'human_review:' || p_operator_id,
        review_reason = p_reason,
        parser_version = v_shadow.normalization_version,
        reprocessed_at = now()
    WHERE id = p_source_record_id
    RETURNING jsonb_build_object(
      'brand', brand, 'reference', reference, 'dial_color', dial_color,
      'condition', condition, 'price_raw', price_raw, 'price_usd', price_usd,
      'currency', currency, 'listing_type', listing_type,
      'listing_status', listing_status, 'verdict', verdict,
      'confidence', LEAST(100, confidence), 'parser_version', parser_version,
      'human_edited', human_edited, 'edit_source', edit_source
    ) INTO v_promoted;

    INSERT INTO public.normalization_promotion_audit (
      source_record_id, review_decision_id, operator_id, reason,
      normalization_version, prior_values, promoted_values
    ) VALUES (
      p_source_record_id, v_decision_id, p_operator_id, p_reason,
      v_shadow.normalization_version, v_prior, v_promoted
    ) RETURNING id INTO v_promotion_id;
  END IF;

  UPDATE public.normalization_shadow_v4
  SET review_status = v_next_status
  WHERE source_record_id = p_source_record_id;

  RETURN jsonb_build_object(
    'review_decision_id', v_decision_id,
    'promotion_audit_id', v_promotion_id,
    'source_record_id', p_source_record_id,
    'review_status', v_next_status,
    'published', p_decision = 'APPROVED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_shadow_review_decision(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_shadow_review_decision(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
