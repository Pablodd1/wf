-- Forward-only Zenith extension over the reconciled QNSA normalization run.
-- This migration changes release controls and adds one small brand-local index.
-- Immutable raw evidence and staging rows are never copied or rewritten.

BEGIN;

ALTER TABLE public.qnsa_two_brand_release_control
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_brand_check;
ALTER TABLE public.qnsa_two_brand_release_control
  ADD CONSTRAINT qnsa_two_brand_release_brand_check
  CHECK (canonical_brand IN (
    'Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier','Zenith'
  ));

ALTER TABLE public.qnsa_two_brand_release_ledger
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_ledger_brand_check;
ALTER TABLE public.qnsa_two_brand_release_ledger
  ADD CONSTRAINT qnsa_two_brand_release_ledger_brand_check
  CHECK (canonical_brand IN (
    'Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier','Zenith'
  ));

INSERT INTO public.qnsa_two_brand_release_control (
  canonical_brand, trading_floor_enabled, price_research_enabled, change_reason
)
VALUES (
  'Zenith', false, false,
  'Zenith reviewed-release extension installed; disabled pending immutable-lineage and single-item audit'
)
ON CONFLICT (canonical_brand) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_zenith_reference_release
  ON staging.listings (
    normalization_run_key,
    reference_normalized,
    listing_type,
    id DESC
  )
  WHERE brand_normalized = 'Zenith'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH';

COMMIT;
