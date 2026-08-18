-- Forward recovery for the intent/image index if an earlier concurrent build
-- was unable to acquire its final lock. The workflow removes only a confirmed
-- invalid shell before this file runs. No table rows or views are changed.

SET lock_timeout = '2min';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_reviewed_workbook_inventory_type_exact_image_id_desc
  ON public.reviewed_workbook_inventory (
    listing_type,
    (
      COALESCE(
        NULLIF(btrim(user_image_url), '') ~* '^https?://[^[:space:]]+$',
        false
      )
    ) DESC,
    id DESC
  )
  WHERE listing_type IS NOT NULL;

ANALYZE public.reviewed_workbook_inventory;
