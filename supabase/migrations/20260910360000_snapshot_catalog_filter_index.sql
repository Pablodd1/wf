-- Run outside a transaction. Root installer verifies the exact index definition,
-- valid/ready state and unchanged snapshot membership before recording completion.
-- This expression depends on immutable published_catalog_model_v1 and
-- published_browse_brand_v1. REINDEX it after changing either helper mapping.
-- Derived snapshot lookup only. No raw, candidate or member payload changes.
-- Expressions match the published brand/model filters installed through300.
CREATE INDEX CONCURRENTLY snapshot_published_brand_model_v1
ON wf_canonical_staging.keyset_snapshot_members (
 snapshot_id,
 lower(wf_canonical_staging.published_browse_brand_v1(payload->>'brand')),
 COALESCE(lower(wf_canonical_staging.published_catalog_model_v1(
  payload->>'model',payload->>'brand',payload->>'reference')),'reference-only listings')
);
