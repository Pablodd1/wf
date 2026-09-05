-- Schema-only support for the explicit owner-reviewed multi-parent display lane.
-- This migration does not insert, update, delete, or publish inventory.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.reviewed_workbook_inventory
  DROP CONSTRAINT IF EXISTS reviewed_workbook_inventory_listing_type_check;

ALTER TABLE public.reviewed_workbook_inventory
  ADD CONSTRAINT reviewed_workbook_inventory_listing_type_check
  CHECK (listing_type IS NULL OR listing_type IN ('WTS', 'WTB', 'OTHER', 'MULTI'))
  NOT VALID;

-- Existing rows already used only the prior WTS/WTB/OTHER vocabulary. Validation
-- is metadata-only for those rows and must complete before any MULTI import.
ALTER TABLE public.reviewed_workbook_inventory
  VALIDATE CONSTRAINT reviewed_workbook_inventory_listing_type_check;

COMMIT;
