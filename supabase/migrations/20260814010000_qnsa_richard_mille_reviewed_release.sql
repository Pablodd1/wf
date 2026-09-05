-- Forward-only Richard Mille extension over the existing reconciled QNSA run.
-- No source, raw-version, or staging listing rows are copied or mutated.

BEGIN;

ALTER TABLE public.qnsa_two_brand_release_control
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_brand_check;
ALTER TABLE public.qnsa_two_brand_release_control
  ADD CONSTRAINT qnsa_two_brand_release_brand_check
  CHECK (canonical_brand IN ('Rolex','Patek Philippe','Audemars Piguet','Richard Mille'));

ALTER TABLE public.qnsa_two_brand_release_ledger
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_ledger_brand_check;
ALTER TABLE public.qnsa_two_brand_release_ledger
  ADD CONSTRAINT qnsa_two_brand_release_ledger_brand_check
  CHECK (canonical_brand IN ('Rolex','Patek Philippe','Audemars Piguet','Richard Mille'));

INSERT INTO public.qnsa_two_brand_release_control (
  canonical_brand, trading_floor_enabled, price_research_enabled, change_reason
)
VALUES (
  'Richard Mille', false, false,
  'Richard Mille reviewed-release extension installed; release remains disabled'
)
ON CONFLICT (canonical_brand) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
