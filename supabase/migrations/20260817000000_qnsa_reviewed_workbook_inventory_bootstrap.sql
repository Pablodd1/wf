-- QNSA forward bootstrap for the already-designed owner-reviewed workbook lane.
-- This creates only the isolated service-role table needed by the existing APIs.
-- It does not touch watch_records, staging.listings, release controls, or raw evidence.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.reviewed_workbook_inventory (
  id text PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  import_run_id text NOT NULL,
  source_file text NOT NULL,
  source_file_sha256 text NOT NULL,
  source_worksheet text NOT NULL,
  source_row_number integer NOT NULL CHECK (source_row_number >= 2),
  source_record_id text,
  source_payload_sha256 text NOT NULL,
  posting_date timestamptz,
  posted_by text,
  phone_number text,
  raw_message text,
  listing_type text CHECK (listing_type IS NULL OR listing_type IN ('WTS', 'WTB', 'OTHER')),
  brand_scope text NOT NULL,
  supplied_brand text,
  canonical_brand text,
  model text,
  raw_reference text,
  normalized_reference text,
  catalog_reference text,
  catalog_model text,
  dial_color text,
  catalog_dial text,
  condition text,
  workbook_price_usd numeric,
  source_price_amount numeric,
  source_price_text text,
  source_currency text,
  price_evidence_status text NOT NULL,
  verification_tier text,
  confidence smallint CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  verification_status text,
  user_image_url text,
  catalog_image_url text,
  final_image_url text,
  display_image_url text,
  has_image boolean GENERATED ALWAYS AS (display_image_url IS NOT NULL) STORED,
  image_evidence_type text CHECK (
    image_evidence_type IS NULL OR image_evidence_type IN ('SELLER_LISTING_IMAGE', 'REFERENCE_IMAGE')
  ),
  review_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  contact_publication_approved boolean NOT NULL DEFAULT false,
  contact_publication_basis text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_workbook_contact_approval_complete CHECK (
    contact_publication_approved IS false OR NULLIF(trim(contact_publication_basis), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_brand_image_price
  ON public.reviewed_workbook_inventory (brand_scope, has_image DESC, workbook_price_usd DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_reference
  ON public.reviewed_workbook_inventory (brand_scope, normalized_reference, posting_date DESC NULLS LAST, id)
  WHERE normalized_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_source
  ON public.reviewed_workbook_inventory (source_file_sha256, source_row_number);
CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_brand_type
  ON public.reviewed_workbook_inventory (brand_scope, listing_type, id);
CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_verified_reference_wts
  ON public.reviewed_workbook_inventory (
    brand_scope,
    (regexp_replace(upper(COALESCE(normalized_reference, '')), '[^A-Z0-9]', '', 'g')),
    posting_date DESC NULLS LAST,
    id
  )
  WHERE listing_type='WTS'
    AND price_evidence_status='SOURCE_EXPLICIT_USD_MATCH'
    AND workbook_price_usd>0;

ALTER TABLE public.reviewed_workbook_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewed_workbook_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_inventory TO service_role;

COMMENT ON TABLE public.reviewed_workbook_inventory IS
  'Service-only owner-reviewed admission inventory. Never a replacement for immutable raw or staging evidence.';
NOTIFY pgrst, 'reload schema';
COMMIT;
