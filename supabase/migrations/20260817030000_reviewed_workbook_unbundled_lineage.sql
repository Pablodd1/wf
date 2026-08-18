-- Forward-only private lineage for deterministic owner-reviewed children.
-- These columns are service-role evidence and are not customer contact data.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.reviewed_workbook_inventory
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_group_id text,
  ADD COLUMN IF NOT EXISTS source_message_id text,
  ADD COLUMN IF NOT EXISTS parent_source_message_id text;

CREATE INDEX IF NOT EXISTS idx_reviewed_workbook_unbundled_parent_lineage
  ON public.reviewed_workbook_inventory (parent_source_message_id, source_message_id, id)
  WHERE parent_source_message_id IS NOT NULL;

COMMENT ON COLUMN public.reviewed_workbook_inventory.source_group_id IS
  'Private source lineage. Never expose through customer APIs.';
COMMENT ON COLUMN public.reviewed_workbook_inventory.parent_source_message_id IS
  'Immutable parent message identity for an approved deterministic child.';

NOTIFY pgrst, 'reload schema';
COMMIT;
