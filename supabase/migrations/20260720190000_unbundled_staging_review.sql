-- Human review and publication boundary for manually separated listing children.
-- Staged rows remain invisible until this function approves one exact child.

CREATE TABLE IF NOT EXISTS public.watch_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  raw_message TEXT,
  brand TEXT,
  reference TEXT,
  dial_color TEXT,
  condition TEXT,
  year INTEGER,
  price_raw NUMERIC,
  price_usd NUMERIC,
  currency TEXT,
  source TEXT,
  confidence INTEGER DEFAULT 0,
  verdict TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT now(),
  normalized_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  parser_version TEXT,
  listing_type TEXT,
  human_edited BOOLEAN DEFAULT false,
  flags JSONB DEFAULT '[]'::jsonb,
  field_confidence JSONB DEFAULT '{}'::jsonb,
  accessories JSONB,
  image_urls JSONB DEFAULT '[]'::jsonb,
  thumbnail_url TEXT,
  has_images BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_watch_staging_batch_review
  ON public.watch_staging (batch_id, verdict, created_at DESC);

CREATE TABLE IF NOT EXISTS public.unbundled_staging_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id UUID NOT NULL REFERENCES public.watch_staging(id) ON DELETE RESTRICT,
  batch_id UUID,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  operator_id TEXT NOT NULL,
  reason TEXT,
  staged_values JSONB NOT NULL,
  published_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unbundled_review_audit_staging
  ON public.unbundled_staging_review_audit (staging_id, created_at DESC);

ALTER TABLE public.unbundled_staging_review_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unbundled_staging_review_audit FROM anon, authenticated;
GRANT ALL ON public.unbundled_staging_review_audit TO service_role;

CREATE OR REPLACE FUNCTION public.apply_unbundled_staging_review_decision(
  p_staging_id UUID,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT DEFAULT NULL,
  p_duplicate_reviewed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.watch_staging;
  v_published_id TEXT;
  v_audit_id UUID;
  v_review_bucket TEXT;
BEGIN
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported review decision';
  END IF;
  IF COALESCE(NULLIF(trim(p_operator_id), ''), '') = '' THEN
    RAISE EXCEPTION 'operator_id is required';
  END IF;
  IF p_decision = 'REJECTED' AND COALESCE(NULLIF(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_stage FROM public.watch_staging WHERE id = p_staging_id FOR UPDATE;
  IF NOT FOUND OR v_stage.verdict <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending staging row not found';
  END IF;
  v_review_bucket := v_stage.field_confidence ->> 'review_bucket';

  IF p_decision = 'APPROVED' THEN
    IF p_duplicate_reviewed IS NOT TRUE
      OR v_review_bucket <> 'review-ready'
      OR COALESCE((v_stage.field_confidence ->> 'exact_raw_lineage')::boolean, false) IS NOT TRUE
      OR COALESCE((v_stage.field_confidence ->> 'catalog_confirmed')::boolean, false) IS NOT TRUE
      OR NULLIF(trim(v_stage.brand), '') IS NULL
      OR NULLIF(trim(v_stage.reference), '') IS NULL
      OR NULLIF(trim(v_stage.listing_type), '') IS NULL
      OR (v_stage.listing_type = 'WTS' AND (v_stage.price_usd IS NULL OR v_stage.currency IS NULL)) THEN
      RAISE EXCEPTION 'Staging row does not meet approval policy';
    END IF;

    v_published_id := v_stage.id::text;
    INSERT INTO public.watch_records (
      id, brand, reference, dial_color, condition, year, price_raw, price_usd,
      currency, confidence, verdict, source, raw_message, flags, created_at,
      processed_at, parser_version, listing_type, accessories, field_confidence,
      human_edited, edit_source, image_urls, thumbnail_url, has_images,
      review_reason, listing_status
    ) VALUES (
      v_published_id, v_stage.brand, v_stage.reference, v_stage.dial_color,
      v_stage.condition, v_stage.year, v_stage.price_raw, v_stage.price_usd,
      v_stage.currency, 100, 'APPROVED', v_stage.source, v_stage.raw_message,
      v_stage.flags, v_stage.created_at, now(), v_stage.parser_version,
      v_stage.listing_type, v_stage.accessories, v_stage.field_confidence,
      true, 'human_review:unbundled:' || p_operator_id,
      v_stage.image_urls, v_stage.thumbnail_url, v_stage.has_images,
      p_reason, 'ACTIVE'
    ) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published record already exists'; END IF;
  END IF;

  INSERT INTO public.unbundled_staging_review_audit (
    staging_id, batch_id, decision, operator_id, reason, staged_values, published_record_id
  ) VALUES (
    v_stage.id, v_stage.batch_id, p_decision, p_operator_id, p_reason,
    to_jsonb(v_stage) || jsonb_build_object('duplicate_reviewed', p_duplicate_reviewed), v_published_id
  ) RETURNING id INTO v_audit_id;

  UPDATE public.watch_staging
  SET verdict = p_decision,
      confidence = CASE WHEN p_decision = 'APPROVED' THEN 100 ELSE 0 END,
      human_edited = true,
      processed_at = now()
  WHERE id = p_staging_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'staging_id', p_staging_id,
    'review_status', p_decision,
    'published', p_decision = 'APPROVED',
    'published_record_id', v_published_id,
    'confidence', CASE WHEN p_decision = 'APPROVED' THEN 100 ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_unbundled_staging_review_decision(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_unbundled_staging_review_decision(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
