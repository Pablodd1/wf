-- Service-only intake and customer-facing API source for owner-supplied
-- reviewed workbooks. This table is deliberately separate from watch_records:
-- workbook rows remain review evidence until their individual identity and
-- price evidence gates pass.

BEGIN;
SET LOCAL lock_timeout = '30s';
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
  listing_type text CHECK (
    listing_type IS NULL OR listing_type IN ('WTS', 'WTB', 'OTHER')
  ),
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
  confidence smallint CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 100
  ),
  verification_status text,
  user_image_url text,
  catalog_image_url text,
  final_image_url text,
  display_image_url text,
  has_image boolean GENERATED ALWAYS AS (display_image_url IS NOT NULL) STORED,
  image_evidence_type text CHECK (
    image_evidence_type IS NULL
    OR image_evidence_type IN ('SELLER_LISTING_IMAGE', 'REFERENCE_IMAGE')
  ),
  review_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  contact_publication_approved boolean NOT NULL DEFAULT false,
  contact_publication_basis text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_workbook_contact_approval_complete CHECK (
    contact_publication_approved IS false
    OR NULLIF(trim(contact_publication_basis), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.reviewed_workbook_import_checkpoints (
  source_file_sha256 text PRIMARY KEY,
  import_run_id text NOT NULL,
  source_file text NOT NULL,
  brand_scope text NOT NULL,
  expected_rows integer NOT NULL CHECK (expected_rows >= 0),
  rows_scanned integer NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
  rows_inserted integer NOT NULL DEFAULT 0 CHECK (rows_inserted >= 0),
  rows_duplicate_held integer NOT NULL DEFAULT 0
    CHECK (rows_duplicate_held >= 0),
  rows_errors integer NOT NULL DEFAULT 0 CHECK (rows_errors >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'RUNNING', 'COMPLETE', 'ERROR')
  ),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_workbook_checkpoint_reconciles CHECK (
    rows_scanned = rows_inserted + rows_duplicate_held + rows_errors
  ),
  CONSTRAINT reviewed_workbook_checkpoint_within_file CHECK (
    rows_scanned <= expected_rows
  )
);

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_brand_image_price
  ON public.reviewed_workbook_inventory (
    brand_scope,
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  );

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_reference
  ON public.reviewed_workbook_inventory (
    brand_scope,
    normalized_reference,
    posting_date DESC NULLS LAST,
    id
  )
  WHERE normalized_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_source
  ON public.reviewed_workbook_inventory (
    source_file_sha256,
    source_row_number
  );

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_checkpoints_brand_status
  ON public.reviewed_workbook_import_checkpoints (brand_scope, status);

ALTER TABLE public.reviewed_workbook_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviewed_workbook_import_checkpoints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reviewed_workbook_inventory
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reviewed_workbook_import_checkpoints
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_inventory
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_import_checkpoints
  TO service_role;

COMMENT ON TABLE public.reviewed_workbook_inventory IS
  'Owner-approved live source-review inventory. Raw evidence and supplied contact are exact workbook values. Rows are not Price Research approval and never write to watch_records.';

COMMENT ON COLUMN public.reviewed_workbook_inventory.workbook_price_usd IS
  'Workbook-supplied USD value retained for review only. It is not Price Research evidence unless price_evidence_status is SOURCE_EXPLICIT_USD_MATCH.';

COMMENT ON COLUMN public.reviewed_workbook_inventory.catalog_image_url IS
  'Reference/catalog evidence only; never represented as a seller listing photo.';

COMMENT ON TABLE public.reviewed_workbook_import_checkpoints IS
  'Idempotent per-workbook import reconciliation for the live source-review inventory.';

NOTIFY pgrst, 'reload schema';
COMMIT;
