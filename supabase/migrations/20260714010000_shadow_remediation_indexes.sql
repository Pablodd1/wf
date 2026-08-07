-- Target the bounded remediation worker without indexing unrelated shadow rows.
-- Production applies migrations manually; run this when shadow writes are idle.

CREATE INDEX IF NOT EXISTS idx_shadow_v4_pending_price_parse_source
  ON public.normalization_shadow_v4 (source_record_id)
  WHERE review_status = 'PENDING'
    AND change_flags @> ARRAY['PRICE_PARSE_FAILED']::TEXT[];

CREATE INDEX IF NOT EXISTS idx_shadow_v4_pending_currency_ambiguous_source
  ON public.normalization_shadow_v4 (source_record_id)
  WHERE review_status = 'PENDING'
    AND change_flags @> ARRAY['CURRENCY_AMBIGUOUS']::TEXT[];
