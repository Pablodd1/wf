-- Keep intent-filtered Trading Floor pages on the same image-first cursor path
-- as the unfiltered floor. This migration is index-only and changes no rows,
-- views, publication decisions, or analytics eligibility.

SET lock_timeout = '5s';
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
