-- Support direct review of every imported workbook by its exact source name.

BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '20min';

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_source_file_order
  ON public.reviewed_workbook_inventory (
    source_file,
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  );

COMMIT;
