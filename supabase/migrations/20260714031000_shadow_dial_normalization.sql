-- Additive evidence for the v4.1 dial-normalization shadow pass.
-- Live watch_records remain immutable; only reviewed promotion may update them.

ALTER TABLE public.normalization_shadow_v4
  ADD COLUMN IF NOT EXISTS source_dial_color TEXT;

COMMENT ON COLUMN public.normalization_shadow_v4.source_dial_color IS
  'Original dial_color retained for audit before any proposed canonicalization.';
