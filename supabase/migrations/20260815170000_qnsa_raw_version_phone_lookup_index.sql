-- Private lookup support for exact dealer/listing linkage.
--
-- This is an index over immutable evidence; it neither rewrites raw evidence
-- nor publishes contact data.  It must be executed outside a transaction so
-- production ingestion is not blocked while the index is built.

SET lock_timeout = '5s';
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qnsa_raw_versions_from_phone
  ON public.raw_message_versions (
    public.normalize_seller_phone_identity(
      raw_payload#>>'{raw_data,from_number}'
    )
  )
  WHERE public.normalize_seller_phone_identity(
    raw_payload#>>'{raw_data,from_number}'
  ) IS NOT NULL;

COMMENT ON INDEX public.idx_qnsa_raw_versions_from_phone IS
  'Private exact-phone lookup over immutable raw lineage; contains no public contact output.';
