-- Preserve exact sealed snapshot identity at the final publication gate too.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE definition text;needle text=$needle$IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows conflict WHERE conflict.source_system=r.source_system
   AND conflict.source_database=r.source_database AND conflict.source_table=r.source_table AND conflict.source_id=r.source_id AND conflict.source_hash<>r.source_hash) THEN$needle$;
 replacement text=$replacement$IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows conflict WHERE conflict.source_system=r.source_system
   AND conflict.source_database=r.source_database AND conflict.source_table=r.source_table AND conflict.source_id=r.source_id AND conflict.source_hash<>r.source_hash) AND NOT EXISTS (
   SELECT 1 FROM wf_canonical_staging.normalization_jobs_v2 j
   JOIN wf_canonical_staging.immutable_source_snapshots s ON s.manifest_sha256=j.immutable_snapshot_sha256
   JOIN wf_canonical_staging.normalization_job_members_v2 m ON m.job_name=j.job_name
    AND m.raw_row_id=v.raw_row_id AND m.source_hash=v.source_hash AND m.proposal_hash=v.proposal_hash
   WHERE j.job_name=v.job_name AND s.sealed AND j.capture_run_key IS NULL
    AND j.manifest_sha256=s.manifest_sha256 AND j.expected_rows=(s.manifest->>'rows')::bigint
    AND (j.source_system,j.source_database,j.source_table)=(r.source_system,r.source_database,r.source_table)
    AND (s.manifest->>'source_system',s.manifest->>'source_database',s.manifest->>'source_table')
     =(r.source_system,r.source_database,r.source_table)
  ) THEN$replacement$;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure),chr(13),'');
 needle=replace(needle,chr(13),'');replacement=replace(replacement,chr(13),'');
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'snapshot_publication_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
COMMIT;
