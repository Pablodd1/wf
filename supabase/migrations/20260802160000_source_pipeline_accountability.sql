-- Service-only operational ledger for source capture and normalization status.
-- This table stores counts and cursors only. It is not a listing publication
-- target and cannot create or modify watch_records.

CREATE TABLE IF NOT EXISTS public.source_pipeline_accountability (
  source_key TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  source_table TEXT,
  pipeline_status TEXT NOT NULL
    CHECK (pipeline_status IN ('PROCESSING', 'CAUGHT_UP', 'ERROR_RETRYING', 'ERROR', 'PAUSED')),
  observed_at TIMESTAMPTZ NOT NULL,
  source_cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_input_rows BIGINT NOT NULL DEFAULT 0 CHECK (source_input_rows >= 0),
  immutable_raw_rows BIGINT NOT NULL DEFAULT 0 CHECK (immutable_raw_rows >= 0),
  normalization_proposal_rows BIGINT NOT NULL DEFAULT 0 CHECK (normalization_proposal_rows >= 0),
  collection_error_rows BIGINT NOT NULL DEFAULT 0 CHECK (collection_error_rows >= 0),
  normalization_error_rows BIGINT NOT NULL DEFAULT 0 CHECK (normalization_error_rows >= 0),
  source_reconciled BOOLEAN NOT NULL DEFAULT false,
  normalization_reconciled BOOLEAN NOT NULL DEFAULT false,
  parser_version TEXT,
  customer_record_writes BIGINT NOT NULL DEFAULT 0 CHECK (customer_record_writes >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.source_pipeline_accountability ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.source_pipeline_accountability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.source_pipeline_accountability TO service_role;

CREATE INDEX IF NOT EXISTS idx_source_pipeline_accountability_observed
  ON public.source_pipeline_accountability (observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_shadow_results_review_status
  ON public.telegram_ingest_shadow_results (review_status, updated_at DESC);

COMMENT ON TABLE public.source_pipeline_accountability IS
  'Service-only source-pipeline counts, reconciliation, cursor and freshness. Never a customer listing or publication target.';
