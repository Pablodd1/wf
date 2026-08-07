-- Required by field-scoped reviewed promotions. This ledger stores the exact
-- before/after values needed to audit or reverse an approved correction.

CREATE TABLE IF NOT EXISTS public.normalization_promotion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id TEXT NOT NULL REFERENCES public.watch_records(id) ON DELETE RESTRICT,
  review_decision_id UUID NOT NULL REFERENCES public.normalization_review_decisions(id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL,
  reason TEXT,
  normalization_version TEXT NOT NULL,
  prior_values JSONB NOT NULL,
  promoted_values JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_promotion_audit_source
  ON public.normalization_promotion_audit (source_record_id, created_at DESC);

ALTER TABLE public.normalization_promotion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_promotion_audit FROM anon, authenticated;
GRANT ALL ON public.normalization_promotion_audit TO service_role;

NOTIFY pgrst, 'reload schema';
