-- A just-created snapshot UUID has no histogram entry. PostgreSQL can estimate
-- one member and choose nested loops across million-row materialized CTEs.
-- Equality joins in this private set-based admission calculation must use a
-- hash/merge plan instead. The setting is scoped to this function invocation.
BEGIN;
ALTER FUNCTION wf_canonical_staging.freeze_research_admission_v2(uuid) SET enable_nestloop TO off;
COMMIT;
