-- Direct authenticated posting is intentionally isolated from the continuous
-- DigitalOcean ingestion jobs. Dealer-entered rows are normalized at the API
-- boundary and materialized into staging.listings for immediate publication.

ALTER TABLE public.dealer_listing_submissions
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS poster_image_url TEXT,
  ADD COLUMN IF NOT EXISTS bulk_submission_id UUID,
  ADD COLUMN IF NOT EXISTS submission_checksum TEXT,
  ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'PUBLISHED'
    CHECK (publication_status IN ('PUBLISHED', 'PUBLICATION_FAILED', 'WITHDRAWN')),
  ADD COLUMN IF NOT EXISTS normalized_at TIMESTAMPTZ;

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS user_image_url TEXT,
  ADD COLUMN IF NOT EXISTS source_submission_id UUID REFERENCES public.dealer_listing_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staging_source_submission_unique
  ON staging.listings (source_submission_id)
  WHERE source_submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_submission_exact_dedup
  ON public.dealer_listing_submissions (auth_user_id, submission_checksum)
  WHERE submission_checksum IS NOT NULL AND publication_status <> 'WITHDRAWN';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dealer-listing-media',
  'dealer-listing-media',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN public.dealer_listing_submissions.publication_status IS
  'Independent publication state for authenticated form submissions; review status remains available for later human QA.';
