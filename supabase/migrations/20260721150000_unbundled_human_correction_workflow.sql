-- Human correction workflow for unbundled staging rows.
-- Raw source evidence remains immutable; corrected fields are audited separately.

ALTER TABLE public.unbundled_staging_review_audit
  DROP CONSTRAINT IF EXISTS unbundled_staging_review_audit_decision_check;

ALTER TABLE public.unbundled_staging_review_audit
  ADD CONSTRAINT unbundled_staging_review_audit_decision_check
  CHECK (decision IN ('APPROVED', 'REJECTED', 'CORRECTED', 'RECYCLED', 'DEFERRED'));

CREATE OR REPLACE FUNCTION public.apply_unbundled_human_review_action(
  p_staging_id UUID,
  p_action TEXT,
  p_operator_id TEXT,
  p_reason TEXT DEFAULT NULL,
  p_fields JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.watch_staging;
  v_before JSONB;
  v_after JSONB;
  v_audit_id UUID;
  v_action TEXT := upper(trim(coalesce(p_action, '')));
  v_brand TEXT;
  v_reference TEXT;
  v_dial TEXT;
  v_condition TEXT;
  v_currency TEXT;
  v_listing_type TEXT;
  v_year INTEGER;
  v_price_raw NUMERIC;
  v_price_usd NUMERIC;
BEGIN
  IF v_action NOT IN ('SAVE', 'DEFER', 'RECYCLE') THEN
    RAISE EXCEPTION 'Unsupported human review action';
  END IF;
  IF coalesce(nullif(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;
  IF v_action IN ('RECYCLE', 'DEFER')
     AND coalesce(nullif(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO v_stage
  FROM public.watch_staging
  WHERE id = p_staging_id
  FOR UPDATE;

  IF NOT FOUND OR v_stage.verdict <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending staging row not found';
  END IF;

  v_before := to_jsonb(v_stage);

  IF v_action = 'SAVE' THEN
    v_brand := nullif(trim(coalesce(p_fields ->> 'brand', v_stage.brand)), '');
    v_reference := nullif(trim(coalesce(p_fields ->> 'reference', v_stage.reference)), '');
    v_dial := nullif(trim(coalesce(p_fields ->> 'dial_color', v_stage.dial_color)), '');
    v_condition := nullif(trim(coalesce(p_fields ->> 'condition', v_stage.condition)), '');
    v_currency := nullif(upper(trim(coalesce(p_fields ->> 'currency', v_stage.currency))), '');
    v_listing_type := nullif(upper(trim(coalesce(p_fields ->> 'listing_type', v_stage.listing_type))), '');
    v_year := CASE
      WHEN p_fields ? 'year' AND nullif(trim(p_fields ->> 'year'), '') IS NOT NULL
        THEN (p_fields ->> 'year')::INTEGER
      ELSE v_stage.year
    END;
    v_price_raw := CASE
      WHEN p_fields ? 'price_raw' AND nullif(trim(p_fields ->> 'price_raw'), '') IS NOT NULL
        THEN (p_fields ->> 'price_raw')::NUMERIC
      ELSE v_stage.price_raw
    END;
    v_price_usd := CASE
      WHEN p_fields ? 'price_usd' AND nullif(trim(p_fields ->> 'price_usd'), '') IS NOT NULL
        THEN (p_fields ->> 'price_usd')::NUMERIC
      ELSE v_stage.price_usd
    END;

    IF v_listing_type NOT IN ('WTS', 'WTB', 'NTQ', 'OTHER') THEN
      RAISE EXCEPTION 'Unsupported listing type';
    END IF;
    IF v_listing_type = 'WTS' AND (v_price_usd IS NULL OR v_currency IS NULL) THEN
      RAISE EXCEPTION 'WTS requires price_usd and currency before saving';
    END IF;

    UPDATE public.watch_staging
    SET brand = v_brand,
        reference = v_reference,
        dial_color = v_dial,
        condition = v_condition,
        year = v_year,
        price_raw = v_price_raw,
        price_usd = v_price_usd,
        currency = v_currency,
        listing_type = v_listing_type,
        human_edited = true,
        field_confidence = coalesce(field_confidence, '{}'::jsonb)
          || jsonb_build_object(
            'human_correction', jsonb_build_object(
              'operator_id', p_operator_id,
              'reason', p_reason,
              'saved_at', now()
            )
          )
    WHERE id = p_staging_id;
  ELSIF v_action = 'RECYCLE' THEN
    UPDATE public.watch_staging
    SET verdict = 'RECYCLE',
        human_edited = true,
        processed_at = now(),
        field_confidence = coalesce(field_confidence, '{}'::jsonb)
          || jsonb_build_object('recycle_reason', p_reason, 'recycled_by', p_operator_id)
    WHERE id = p_staging_id;
  END IF;

  SELECT to_jsonb(s) INTO v_after FROM public.watch_staging s WHERE s.id = p_staging_id;

  INSERT INTO public.unbundled_staging_review_audit
    (staging_id, batch_id, decision, operator_id, reason, staged_values)
  VALUES
    (p_staging_id, v_stage.batch_id,
     CASE WHEN v_action = 'SAVE' THEN 'CORRECTED'
          WHEN v_action = 'RECYCLE' THEN 'RECYCLED'
          ELSE 'DEFERRED' END,
     p_operator_id, p_reason,
     jsonb_build_object('before', v_before, 'after', v_after, 'fields', coalesce(p_fields, '{}'::jsonb)))
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'staging_id', p_staging_id,
    'action', v_action,
    'status', CASE WHEN v_action = 'RECYCLE' THEN 'RECYCLE' ELSE 'PENDING' END,
    'requires_revalidation', v_action = 'SAVE'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_unbundled_human_review_action(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_unbundled_human_review_action(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
