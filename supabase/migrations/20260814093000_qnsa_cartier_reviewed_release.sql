-- Forward-only Cartier extension over the existing reconciled QNSA run.
-- This changes only release controls; raw messages and staging listings remain immutable.

BEGIN;

ALTER TABLE public.qnsa_two_brand_release_control
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_brand_check;
ALTER TABLE public.qnsa_two_brand_release_control
  ADD CONSTRAINT qnsa_two_brand_release_brand_check
  CHECK (canonical_brand IN ('Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier'));

ALTER TABLE public.qnsa_two_brand_release_ledger
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_ledger_brand_check;
ALTER TABLE public.qnsa_two_brand_release_ledger
  ADD CONSTRAINT qnsa_two_brand_release_ledger_brand_check
  CHECK (canonical_brand IN ('Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier'));

INSERT INTO public.qnsa_two_brand_release_control (
  canonical_brand, trading_floor_enabled, price_research_enabled, change_reason
)
VALUES (
  'Cartier', false, false,
  'Cartier reviewed-release extension installed; release remains disabled pending bounded audit'
)
ON CONFLICT (canonical_brand) DO NOTHING;

COMMIT;
