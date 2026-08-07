-- Production deployment retry for the normalization v4 shadow schema.
--
-- Supabase Git deployments only apply new migration files. This repeats the
-- original additive schema idempotently so a production deployment can pick it
-- up without modifying public.watch_records. It is safe if the original
-- 20260713003000 migration is applied later.

CREATE TABLE IF NOT EXISTS public.normalization_shadow_v4 (
  source_record_id TEXT PRIMARY KEY REFERENCES public.watch_records(id) ON DELETE CASCADE,
  normalization_version TEXT NOT NULL,
  source_parser_version TEXT,
  source_brand TEXT,
  source_reference TEXT,
  source_price_raw NUMERIC,
  source_price_usd NUMERIC,
  source_currency TEXT,
  source_listing_type TEXT,
  candidate_count INTEGER NOT NULL,
  proposed_candidates JSONB NOT NULL,
  change_flags TEXT[] NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_shadow_v4_review_status
  ON public.normalization_shadow_v4 (review_status, analyzed_at);

CREATE INDEX IF NOT EXISTS idx_normalization_shadow_v4_change_flags
  ON public.normalization_shadow_v4 USING GIN (change_flags);

CREATE TABLE IF NOT EXISTS public.normalization_shadow_checkpoints (
  job_name TEXT PRIMARY KEY,
  last_source_record_id TEXT,
  rows_analyzed BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.normalization_shadow_v4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalization_shadow_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_shadow_v4 FROM anon, authenticated;
REVOKE ALL ON public.normalization_shadow_checkpoints FROM anon, authenticated;
GRANT ALL ON public.normalization_shadow_v4 TO service_role;
GRANT ALL ON public.normalization_shadow_checkpoints TO service_role;
