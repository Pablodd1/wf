-- Support the default Source Review order when no brand filter is selected.
-- The existing brand-leading index cannot serve this global order.

BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '20min';

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_inventory_global_image_price
  ON public.reviewed_workbook_inventory (
    has_image DESC,
    workbook_price_usd DESC NULLS LAST,
    id
  );

ANALYZE public.reviewed_workbook_inventory;

COMMIT;
