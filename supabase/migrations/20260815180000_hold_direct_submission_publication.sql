-- Keep authenticated POST IT intake and immutable evidence capture available,
-- but fail closed on publication until the shared normalization, identity,
-- currency, duplicate, bundle, media, and contact-consent gates have passed an
-- authenticated end-to-end canary. Rejection remains available to reviewers.

BEGIN;

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
SET search_path = public, jobs, pg_temp
AS $$
DECLARE
  v_submission public.dealer_listing_submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_submission
  FROM public.dealer_listing_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dealer submission % does not exist', p_submission_id;
  END IF;

  IF v_submission.review_status IN ('APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Dealer submission % already has a terminal decision', p_submission_id;
  END IF;

  IF upper(COALESCE(p_decision, '')) = 'APPROVE' THEN
    RAISE EXCEPTION 'DEALER_SUBMISSION_PUBLICATION_HELD: shared validation gates are not yet proven';
  END IF;

  IF upper(COALESCE(p_decision, '')) <> 'REJECT' THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;

  UPDATE public.dealer_listing_submissions
  SET review_status = 'REJECTED',
      publication_status = 'REJECTED',
      review_notes = p_review_notes,
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_submission_id;

  UPDATE jobs.processing_jobs
  SET status = 'rejected'::jobs.processing_status,
      completed_at = now()
  WHERE id = v_submission.processing_job_id;

  submission_id := p_submission_id;
  listing_id := NULL;
  publication_status := 'REJECTED';
  price_research_status := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.review_dealer_submission(UUID, TEXT, UUID, TEXT, JSONB) IS
  'Safety hold: POST IT intake and rejection remain available; approval cannot publish until a later forward migration installs the evidence-gated promotion contract.';

COMMIT;
