-- Authenticated dealer submissions are review-only. They never enter the
-- Trading Floor or Price Research until a reviewer validates raw evidence,
-- catalog identity, intent, price, currency, and dealer attribution.

ALTER TABLE public.dealers
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealers_auth_user_unique
  ON public.dealers (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dealer_listing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  intent TEXT NOT NULL CHECK (intent IN ('WTS', 'WTB')),
  category TEXT NOT NULL CHECK (category IN ('WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER')),
  raw_message TEXT NOT NULL CHECK (char_length(raw_message) BETWEEN 3 AND 10000),
  claimed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (review_status IN ('PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  review_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_submissions_review_created
  ON public.dealer_listing_submissions (review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_submissions_user_created
  ON public.dealer_listing_submissions (auth_user_id, created_at DESC);

ALTER TABLE public.dealer_listing_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_listing_submissions FROM anon, authenticated;
GRANT ALL ON public.dealer_listing_submissions TO service_role;

COMMENT ON TABLE public.dealer_listing_submissions IS
  'Immutable dealer-entered evidence and separate claimed fields. Review approval is required before materializing a public listing.';
