-- Production has the older staging listing/dealer shape. These optional
-- directory fields remain unknown for existing rows; do not guess intent or
-- membership dates from an import timestamp.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE staging.listings ADD COLUMN IF NOT EXISTS listing_type varchar(20);
ALTER TABLE public.dealers ADD COLUMN IF NOT EXISTS member_since text;
COMMIT;
