-- A partial dealer-link canary must not make partial WTS/WTB totals look final.
-- This private checkpoint is written only after one dealer's exact-phone scan
-- reaches the end of its immutable, release-gated candidate stream.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.dealer_listing_linkage_checkpoints (
  dealer_id uuid PRIMARY KEY REFERENCES public.dealers(id) ON DELETE CASCADE,
  run_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETE', 'FAILED')),
  scanned_count bigint NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  eligible_count bigint NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  applied_count bigint NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  conflicting_count bigint NOT NULL DEFAULT 0 CHECK (conflicting_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((status = 'COMPLETE' AND completed_at IS NOT NULL)
    OR (status <> 'COMPLETE' AND completed_at IS NULL))
);

ALTER TABLE public.dealer_listing_linkage_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_listing_linkage_checkpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dealer_listing_linkage_checkpoints
  TO service_role, postgres, supabase_admin;

COMMENT ON TABLE public.dealer_listing_linkage_checkpoints IS
  'Private per-dealer completion proof; APPLIED link existence alone is never completion.';

COMMIT;
