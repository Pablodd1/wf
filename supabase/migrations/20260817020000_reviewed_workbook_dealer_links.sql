-- Service-only exact dealer links for owner-reviewed workbook inventory.
-- The source identity used to prove a link remains in dealer_source_identities;
-- this table retains only non-reversible evidence hashes and never publishes a
-- phone/WhatsApp identifier.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.reviewed_workbook_dealer_links (
  reviewed_listing_id text PRIMARY KEY
    REFERENCES public.reviewed_workbook_inventory(id) ON DELETE CASCADE,
  dealer_id uuid NOT NULL REFERENCES public.dealers(id) ON DELETE RESTRICT,
  source_system text NOT NULL,
  link_method text NOT NULL CHECK (link_method = 'EXACT_VERIFIED_PHONE'),
  link_status text NOT NULL DEFAULT 'APPLIED'
    CHECK (link_status IN ('APPLIED', 'REVOKED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_workbook_dealer_link_evidence_no_contact CHECK (
    NOT evidence ?| ARRAY[
      'phone', 'phone_number', 'whatsapp', 'source_identity',
      'seller_source_id', 'contact'
    ]
    AND evidence - ARRAY[
      'source_identity_hmac_sha256', 'source_file_sha256',
      'source_row_number', 'source_record_id_sha256',
      'verification_basis'
    ] = '{}'::jsonb
    AND COALESCE(evidence->>'source_identity_hmac_sha256', '') ~ '^[0-9a-f]{64}$'
    AND COALESCE(evidence->>'source_file_sha256', '') ~ '^[0-9a-f]{64}$'
    AND COALESCE(evidence->>'source_record_id_sha256', '') ~ '^[0-9a-f]{64}$'
    AND COALESCE(evidence->>'verification_basis', '')
      = 'UNIQUE_VERIFIED_PHONE_OR_WHATSAPP_TO_VERIFIED_DEALER'
  )
);

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_dealer_links_profile
  ON public.reviewed_workbook_dealer_links (
    dealer_id, link_status, reviewed_listing_id
  );

ALTER TABLE public.reviewed_workbook_dealer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewed_workbook_dealer_links
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviewed_workbook_dealer_links
  TO service_role;

COMMENT ON TABLE public.reviewed_workbook_dealer_links IS
  'Private exact VERIFIED PHONE/WHATSAPP linkage from reviewed workbook text listing IDs to canonical verified dealers. No contact identity is retained here or exposed publicly.';
COMMENT ON COLUMN public.reviewed_workbook_dealer_links.evidence IS
  'Non-reversible hashes and workbook lineage only; raw phone/WhatsApp/contact values are forbidden.';

NOTIFY pgrst, 'reload schema';
COMMIT;
