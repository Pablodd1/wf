-- Route authenticated Post an Item submissions through the immutable pipeline
-- and an explicit reviewer decision. Nothing is publicly released at intake.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.dealer_listing_submissions
  DROP CONSTRAINT IF EXISTS dealer_listing_submissions_review_status_check,
  DROP CONSTRAINT IF EXISTS dealer_listing_submissions_publication_status_check;

ALTER TABLE public.dealer_listing_submissions
  ADD COLUMN IF NOT EXISTS raw_payload_id UUID REFERENCES raw.payloads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processing_job_id UUID REFERENCES jobs.processing_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ALTER COLUMN review_status SET DEFAULT 'PENDING_REVIEW',
  ALTER COLUMN publication_status SET DEFAULT 'QUEUED';

ALTER TABLE public.dealer_listing_submissions
  ADD CONSTRAINT dealer_listing_submissions_review_status_check
    CHECK (review_status IN ('PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  ADD CONSTRAINT dealer_listing_submissions_publication_status_check
    CHECK (publication_status IN ('QUEUED', 'PUBLISHED', 'QUEUE_FAILED', 'REJECTED', 'WITHDRAWN'));

CREATE INDEX IF NOT EXISTS idx_dealer_submissions_pipeline_job
  ON public.dealer_listing_submissions (processing_job_id)
  WHERE processing_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_dealer_submission_batch(p_submission_ids UUID[])
RETURNS TABLE(submission_id UUID, raw_payload_id UUID, processing_job_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, raw, jobs, pg_temp
AS $$
DECLARE
  s public.dealer_listing_submissions%ROWTYPE;
  d public.dealers%ROWTYPE;
  v_payload_id UUID;
  v_job_id UUID;
  v_checksum TEXT;
BEGIN
  FOREACH submission_id IN ARRAY p_submission_ids LOOP
    SELECT * INTO s
    FROM public.dealer_listing_submissions
    WHERE id = submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dealer submission % does not exist', submission_id;
    END IF;

    IF s.raw_payload_id IS NOT NULL AND s.processing_job_id IS NOT NULL THEN
      raw_payload_id := s.raw_payload_id;
      processing_job_id := s.processing_job_id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT * INTO d FROM public.dealers WHERE id = s.dealer_id;
    v_payload_id := gen_random_uuid();
    v_job_id := gen_random_uuid();
    v_checksum := encode(digest(
      submission_id::text || ':' || s.raw_message || ':' || s.claimed_fields::text || ':' || s.image_urls::text,
      'sha256'
    ), 'hex');

    INSERT INTO raw.payloads (
      id, source_platform, source_group_id, source_group_name, source_message_id,
      source_sender_id, source_sender_name, original_message_text, original_timestamp,
      bring_metadata, original_image_references, payload_checksum, record_version
    ) VALUES (
      v_payload_id, 'DIRECT_DEALER_FORM', s.dealer_id::text,
      COALESCE(d.company_name, d.display_name), submission_id::text,
      s.auth_user_id::text, COALESCE(d.display_name, d.company_name), s.raw_message, s.created_at,
      jsonb_build_object(
        'submission_id', s.id,
        'dealer_id', s.dealer_id,
        'intent', s.intent,
        'category', s.category,
        'claimed_fields', s.claimed_fields,
        'poster_image_url', s.poster_image_url,
        'bulk_submission_id', s.bulk_submission_id,
        'source', 'authenticated_user_form'
      ),
      s.image_urls, v_checksum, '1.0'
    )
    ON CONFLICT (payload_checksum) DO UPDATE
      SET record_version = EXCLUDED.record_version
    RETURNING id INTO v_payload_id;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, schema_version)
    VALUES (v_job_id, v_payload_id, 'needs_review'::jobs.processing_status, 'dealer-form-v1')
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.dealer_listing_submissions
    SET raw_payload_id = v_payload_id,
        processing_job_id = v_job_id,
        review_status = 'PENDING_REVIEW',
        publication_status = 'QUEUED',
        queued_at = now(),
        updated_at = now()
    WHERE id = submission_id;

    raw_payload_id := v_payload_id;
    processing_job_id := v_job_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_dealer_submission(
  p_submission_id UUID,
  p_decision TEXT,
  p_reviewer_id UUID,
  p_review_notes TEXT DEFAULT NULL,
  p_normalized_fields JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(submission_id UUID, listing_id UUID, publication_status TEXT, price_research_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, jobs, pg_temp
AS $$
DECLARE
  s public.dealer_listing_submissions%ROWTYPE;
  d public.dealers%ROWTYPE;
  v_listing_id UUID;
  v_brand TEXT;
  v_model TEXT;
  v_reference TEXT;
  v_dial TEXT;
  v_condition TEXT;
  v_title TEXT;
  v_currency TEXT;
  v_price NUMERIC;
  v_catalog_confirmed BOOLEAN := false;
  v_price_status TEXT;
  v_location TEXT;
BEGIN
  SELECT * INTO s FROM public.dealer_listing_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dealer submission % does not exist', p_submission_id; END IF;
  IF s.review_status IN ('APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Dealer submission % already has a terminal decision', p_submission_id;
  END IF;
  IF upper(p_decision) NOT IN ('APPROVE', 'REJECT') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;

  IF upper(p_decision) = 'REJECT' THEN
    UPDATE public.dealer_listing_submissions
    SET review_status = 'REJECTED', publication_status = 'REJECTED', review_notes = p_review_notes,
        reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_submission_id;
    UPDATE jobs.processing_jobs SET status = 'rejected'::jobs.processing_status, completed_at = now()
    WHERE id = s.processing_job_id;
    submission_id := p_submission_id; listing_id := NULL; publication_status := 'REJECTED'; price_research_status := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF COALESCE((s.claimed_fields->>'is_bundle')::boolean, false) THEN
    RAISE EXCEPTION 'Bundle submissions require the separate bundle workflow';
  END IF;

  SELECT * INTO d FROM public.dealers WHERE id = s.dealer_id;
  v_brand := COALESCE(NULLIF(trim(p_normalized_fields->>'brand'), ''), NULLIF(trim(s.claimed_fields->>'brand'), ''));
  v_model := COALESCE(NULLIF(trim(p_normalized_fields->>'model'), ''), NULLIF(trim(s.claimed_fields->>'model'), ''));
  v_reference := COALESCE(NULLIF(trim(p_normalized_fields->>'reference'), ''), NULLIF(trim(s.claimed_fields->>'reference'), ''));
  v_dial := COALESCE(NULLIF(trim(p_normalized_fields->>'dial_color'), ''), NULLIF(trim(s.claimed_fields->>'dial_color'), ''));
  v_condition := COALESCE(NULLIF(trim(p_normalized_fields->>'condition'), ''), NULLIF(trim(s.claimed_fields->>'condition'), ''));
  v_title := COALESCE(NULLIF(trim(p_normalized_fields->>'title'), ''), NULLIF(trim(s.claimed_fields->>'title'), ''), left(s.raw_message, 240));
  v_currency := upper(COALESCE(NULLIF(trim(p_normalized_fields->>'currency'), ''), NULLIF(trim(s.claimed_fields->>'currency'), '')));
  IF COALESCE(p_normalized_fields->>'price_amount', s.claimed_fields->>'price_amount', '') ~ '^\d+(\.\d+)?$' THEN
    v_price := COALESCE(p_normalized_fields->>'price_amount', s.claimed_fields->>'price_amount')::numeric;
  END IF;
  IF lower(COALESCE(p_normalized_fields->>'catalog_confirmed', 'false')) IN ('true', '1', 'yes') THEN
    v_catalog_confirmed := true;
  END IF;

  IF s.category = 'WATCH' AND (v_brand IS NULL OR v_model IS NULL OR v_reference IS NULL OR v_dial IS NULL) THEN
    RAISE EXCEPTION 'A reviewed watch requires brand, model, reference, and dial color';
  END IF;

  v_price_status := CASE
    WHEN s.category <> 'WATCH' THEN 'ineligible_non_watch'
    WHEN s.intent = 'WTB' THEN 'ineligible_demand'
    WHEN v_price IS NULL THEN 'ineligible_no_price'
    WHEN v_currency <> 'USD' THEN 'provisional_needs_review'
    WHEN NOT v_catalog_confirmed THEN 'provisional_needs_review'
    ELSE 'eligible'
  END;
  v_location := concat_ws(', ', NULLIF(trim(d.city), ''), NULLIF(trim(d.country_code), ''));

  SELECT id INTO v_listing_id FROM staging.listings WHERE source_submission_id = p_submission_id LIMIT 1;
  IF v_listing_id IS NULL THEN
    v_listing_id := gen_random_uuid();
    INSERT INTO staging.listings (
      id, job_id, source_submission_id, dealer_id, raw_message_text, category, intent, listing_type, is_bundle,
      brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized,
      dial_color_original, dial_color_normalized, condition_original, condition_normalized,
      price_original, price_normalized, price_usd, currency_original, currency_normalized,
      image_url, image_urls, user_image_url, user_name, from_name, contact_number, from_number, location,
      rating, dealer_rating, contact_consent, is_verified_user, is_seller_approved,
      catalog_confirmed, catalog_canonical_confirmed, are_attributes_extracted, identification_status,
      verdict, normalization_status, trading_floor_status, price_research_status, overall_confidence,
      provenance_metadata
    ) VALUES (
      v_listing_id, s.processing_job_id, s.id, s.dealer_id, s.raw_message, s.category, s.intent, s.intent, false,
      v_brand, v_brand, v_model, v_model, v_reference, v_reference, v_dial, v_dial, v_condition, v_condition,
      v_price, v_price, CASE WHEN v_currency = 'USD' THEN v_price ELSE NULL END, v_currency, v_currency,
      s.image_urls[1], s.image_urls, s.poster_image_url,
      COALESCE(d.display_name, d.company_name), COALESCE(d.display_name, d.company_name),
      s.claimed_fields->>'poster_phone', s.claimed_fields->>'poster_phone', NULLIF(v_location, ''),
      d.rating, d.rating, true, d.status = 'VERIFIED', d.status = 'VERIFIED',
      v_catalog_confirmed, v_catalog_confirmed, true, CASE WHEN s.category = 'WATCH' THEN 'identified' ELSE 'normalized' END,
      'approved', 'normalized', 'published', v_price_status, 1,
      jsonb_build_object(
        'source', 'authenticated_user_form', 'submission_id', s.id, 'bulk_submission_id', s.bulk_submission_id,
        'reviewer_id', p_reviewer_id, 'reviewed_at', now(), 'poster_image_url', s.poster_image_url,
        'credential_stamp', jsonb_build_object('auth_user_id', s.auth_user_id, 'dealer_id', s.dealer_id, 'status', d.status),
        'display_title', v_title
      )
    );
  END IF;

  UPDATE public.dealer_listing_submissions
  SET claimed_fields = claimed_fields || p_normalized_fields,
      review_status = 'APPROVED', publication_status = 'PUBLISHED', review_notes = p_review_notes,
      reviewed_by = p_reviewer_id, reviewed_at = now(), published_at = now(), normalized_at = now(), updated_at = now()
  WHERE id = p_submission_id;
  UPDATE jobs.processing_jobs SET status = 'approved'::jobs.processing_status, completed_at = now()
  WHERE id = s.processing_job_id;

  submission_id := p_submission_id; listing_id := v_listing_id; publication_status := 'PUBLISHED'; price_research_status := v_price_status;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_dealer_submission_batch(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dealer_submission_batch(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.enqueue_dealer_submission_batch(UUID[]) IS
  'Creates immutable raw payloads and needs-review jobs for authenticated Post an Item submissions.';
COMMENT ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB) IS
  'The sole reviewed path from an authenticated submission into staging publication and watch-only Price Research eligibility.';
