-- Production raw rows have no disposable fixture-tag column. The immutable
-- synthetic payload flag remains mandatory evidence at the release boundary.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE definition text;needle text='r.test_run_id LIKE ''%SYNTHETIC%''';
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'publication_fixture_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,'(to_jsonb(r)->>''test_run_id'') LIKE ''%SYNTHETIC%''');
END $migration$;
COMMIT;
