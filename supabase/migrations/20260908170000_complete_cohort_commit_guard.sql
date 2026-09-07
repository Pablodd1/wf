BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE definition text; needle text='SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton;';
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.guard_publication_snapshot_commit_v2()'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'cohort_commit_guard_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,
  'IF (batch.result->>''inserted'')::bigint+(batch.result->>''changed'')::bigint=0 THEN RETURN NULL; END IF;'||chr(10)||needle);
END $$;
DROP TRIGGER guard_publication_snapshot_commit_v2 ON wf_canonical_staging.publication_batches_v2;
CREATE CONSTRAINT TRIGGER guard_publication_snapshot_commit_v2 AFTER INSERT ON wf_canonical_staging.publication_batches_v2
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wf_canonical_staging.guard_publication_snapshot_commit_v2();
COMMIT;
