-- Avoid a full normalization_shadow_v4 scan for every Trading Floor row.
-- CONCURRENTLY keeps the normalization worker writable during index creation.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shadow_v4_bundle_parent_source
  ON public.normalization_shadow_v4 (source_record_id)
  WHERE candidate_count > 1;

COMMENT ON INDEX public.idx_shadow_v4_bundle_parent_source IS
  'Supports customer-market exclusion of unsplit multi-watch source parents.';
