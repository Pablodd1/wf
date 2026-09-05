-- Forward-only compatibility for audited price corrections.
-- Adding a nullable timestamp without a default is metadata-only in PostgreSQL
-- and does not rewrite or change the cardinality of staging.listings.

BEGIN;

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

COMMENT ON COLUMN staging.listings.updated_at IS
  'Timestamp of the latest audited correction to an existing normalized listing.';

COMMIT;
