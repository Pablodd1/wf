-- Global Trading Floor image-first ordering for the currently deployed
-- reviewed-workbook architecture.
--
-- This migration is intentionally index-only. It does not replace a view,
-- rewrite source evidence, touch ingestion tables, or change publication
-- eligibility. PostgreSQL must run CREATE INDEX CONCURRENTLY outside an
-- explicit transaction.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_exact_image_id_desc
  ON public.reviewed_workbook_inventory (
    (
      COALESCE(
        NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$',
        false
      )
    ) DESC,
    id DESC
  );

ANALYZE public.reviewed_workbook_inventory;
