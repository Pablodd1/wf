-- Persist catalog-backed model identity for new and reviewed records.
-- Existing rows remain false/null until a bounded, audited backfill confirms
-- their brand + reference against the versioned catalog.

ALTER TABLE public.watch_records
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS catalog_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_match JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.watch_records.model IS
  'Catalog-backed model name. AI output alone must never populate this field.';
COMMENT ON COLUMN public.watch_records.catalog_confirmed IS
  'True only after deterministic brand/reference catalog confirmation.';
COMMENT ON COLUMN public.watch_records.catalog_match IS
  'Versioned confirmation provenance including source, match type, and canonical reference.';

NOTIFY pgrst, 'reload schema';
