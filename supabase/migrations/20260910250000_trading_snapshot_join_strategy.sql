-- Full-population snapshot construction joins tens of thousands of approved
-- source links. Their correlated proof predicates can severely under-estimate
-- cardinality and select a repeated nested-loop scan. Scope the measured
-- alternative to this bulk materializer; caller and pagination settings remain
-- unchanged, as do its query body, payloads, source proof and privileges.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER FUNCTION wf_canonical_staging.materialize_trading_floor_snapshot(integer)
 SET enable_nestloop TO off;
COMMIT;
