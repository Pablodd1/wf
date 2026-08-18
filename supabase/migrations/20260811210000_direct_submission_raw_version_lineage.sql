-- Give authenticated POST IT submissions the same immutable source-version
-- lineage required by the QNSA Trading Floor and Price Research release gates.
-- This is forward-only and does not publish or normalize any existing row.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.dealer_listing_submissions
  ADD COLUMN IF NOT EXISTS raw_message_version_id UUID
    REFERENCES public.raw_message_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_dealer_submissions_raw_message_version
  ON public.dealer_listing_submissions (raw_message_version_id)
  WHERE raw_message_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_dealer_submission_raw_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_raw_message_id UUID;
  v_version_id UUID;
  v_source_hash TEXT;
  v_media JSONB;
BEGIN
  IF NEW.raw_message_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_source_hash := COALESCE(
    NULLIF(lower(NEW.submission_checksum), ''),
    encode(digest(convert_to(NEW.raw_message, 'UTF8'), 'sha256'), 'hex')
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'public_url', media_url,
    'relationship', 'authenticated_submission_media',
    'verified_for_child_listing', NOT COALESCE((NEW.claimed_fields->>'is_bundle')::boolean, false)
  )), '[]'::jsonb)
  INTO v_media
  FROM unnest(COALESCE(NEW.image_urls, '{}'::text[])) AS media_url;

  INSERT INTO public.raw_messages (
    external_message_id, sender_phone, group_id, source_platform, received_at,
    raw_text, raw_payload, media_count, processing_status, parser_version
  ) VALUES (
    NEW.id::text,
    NEW.claimed_fields->>'poster_phone',
    NEW.dealer_id::text,
    'direct_dealer_form',
    COALESCE(NEW.created_at, now()),
    NEW.raw_message,
    jsonb_build_object(
      'contract', 'wf-direct-dealer-form-raw-v1',
      'submission_id', NEW.id,
      'dealer_id', NEW.dealer_id,
      'auth_user_id', NEW.auth_user_id,
      'intent', NEW.intent,
      'category', NEW.category,
      'claimed_fields', NEW.claimed_fields,
      'image_urls', NEW.image_urls,
      'poster_image_url', NEW.poster_image_url,
      'bulk_submission_id', NEW.bulk_submission_id
    ),
    COALESCE(cardinality(NEW.image_urls), 0),
    'COPIED_RAW',
    NULL
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_raw_message_id;

  IF v_raw_message_id IS NULL THEN
    SELECT id INTO v_raw_message_id
    FROM public.raw_messages
    WHERE source_platform = 'direct_dealer_form'
      AND external_message_id = NEW.id::text;
  END IF;

  IF v_raw_message_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve immutable raw message for dealer submission %', NEW.id;
  END IF;

  INSERT INTO public.raw_message_versions (
    raw_message_id, source_record_id, source_hash, source_created_on,
    source_updated_on, observed_at, raw_message_source, raw_text,
    raw_payload, media
  ) VALUES (
    v_raw_message_id,
    NEW.id::text,
    v_source_hash,
    COALESCE(NEW.created_at, now())::text,
    COALESCE(NEW.updated_at, NEW.created_at, now())::text,
    COALESCE(NEW.created_at, now()),
    'authenticated_user_form',
    NEW.raw_message,
    jsonb_build_object(
      'contract', 'wf-direct-dealer-form-raw-v1',
      'submission_id', NEW.id,
      'raw_message', NEW.raw_message,
      'intent', NEW.intent,
      'category', NEW.category,
      'claimed_fields', NEW.claimed_fields,
      'credential_stamp', jsonb_build_object(
        'auth_user_id', NEW.auth_user_id,
        'dealer_id', NEW.dealer_id,
        'source_evidence_confirmed', NEW.claimed_fields->>'source_evidence_confirmed',
        'source_evidence_confirmed_at', NEW.claimed_fields->>'source_evidence_confirmed_at'
      )
    ),
    v_media
  )
  ON CONFLICT (raw_message_id, source_hash) DO NOTHING
  RETURNING id INTO v_version_id;

  IF v_version_id IS NULL THEN
    SELECT id INTO v_version_id
    FROM public.raw_message_versions
    WHERE raw_message_id = v_raw_message_id
      AND source_hash = v_source_hash;
  END IF;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve immutable raw version for dealer submission %', NEW.id;
  END IF;

  NEW.raw_message_version_id := v_version_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_dealer_submission_raw_version
  ON public.dealer_listing_submissions;
CREATE TRIGGER trg_capture_dealer_submission_raw_version
  BEFORE INSERT ON public.dealer_listing_submissions
  FOR EACH ROW EXECUTE FUNCTION public.capture_dealer_submission_raw_version();

CREATE OR REPLACE FUNCTION staging.attach_direct_submission_raw_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
BEGIN
  IF NEW.source_submission_id IS NOT NULL AND NEW.raw_message_version_id IS NULL THEN
    SELECT raw_message_version_id INTO NEW.raw_message_version_id
    FROM public.dealer_listing_submissions
    WHERE id = NEW.source_submission_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_direct_submission_raw_version
  ON staging.listings;
CREATE TRIGGER trg_attach_direct_submission_raw_version
  BEFORE INSERT OR UPDATE OF source_submission_id ON staging.listings
  FOR EACH ROW EXECUTE FUNCTION staging.attach_direct_submission_raw_version();

REVOKE ALL ON FUNCTION public.capture_dealer_submission_raw_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION staging.attach_direct_submission_raw_version()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_dealer_submission_raw_version() TO service_role;
GRANT EXECUTE ON FUNCTION staging.attach_direct_submission_raw_version() TO service_role;

COMMENT ON COLUMN public.dealer_listing_submissions.raw_message_version_id IS
  'Immutable source version for the exact authenticated raw message and submission evidence.';

COMMIT;
