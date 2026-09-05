BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.reviewed_workbook_import_checkpoints (
  source_file_sha256 text PRIMARY KEY,
  import_run_id text NOT NULL,
  source_file text NOT NULL,
  brand_scope text NOT NULL,
  expected_rows integer NOT NULL CHECK (expected_rows >= 0),
  rows_scanned integer NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
  rows_inserted integer NOT NULL DEFAULT 0 CHECK (rows_inserted >= 0),
  rows_duplicate_held integer NOT NULL DEFAULT 0 CHECK (rows_duplicate_held >= 0),
  rows_errors integer NOT NULL DEFAULT 0 CHECK (rows_errors >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETE','ERROR')),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_workbook_checkpoint_reconciles CHECK (
    rows_scanned = rows_inserted + rows_duplicate_held + rows_errors
  ),
  CONSTRAINT reviewed_workbook_checkpoint_within_file CHECK (rows_scanned <= expected_rows)
);

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_checkpoints_brand_status
  ON public.reviewed_workbook_import_checkpoints (brand_scope, status);
ALTER TABLE public.reviewed_workbook_import_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewed_workbook_import_checkpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviewed_workbook_import_checkpoints TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
