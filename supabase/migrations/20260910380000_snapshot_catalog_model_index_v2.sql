-- Run outside a transaction. Keep V1 index valid until the RPC switch commits.
CREATE INDEX CONCURRENTLY snapshot_published_brand_model_v2
ON wf_canonical_staging.keyset_snapshot_members
(snapshot_id,lower(wf_canonical_staging.published_browse_brand_v1(payload->>'brand')),
 coalesce(lower(wf_canonical_staging.published_catalog_model_v2(payload->>'model',payload->>'brand',payload->>'reference')),'reference-only listings'));
