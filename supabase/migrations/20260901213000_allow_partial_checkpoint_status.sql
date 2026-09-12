-- Forward-only migration: Add PARTIAL status to checkpoint table check constraint
-- Migration ID: 20260901213000_allow_partial_checkpoint_status

BEGIN;

ALTER TABLE wf_canonical_staging.mariadb_raw_import_checkpoints
  DROP CONSTRAINT IF EXISTS mariadb_raw_import_checkpoints_status_check;

ALTER TABLE wf_canonical_staging.mariadb_raw_import_checkpoints
  ADD CONSTRAINT mariadb_raw_import_checkpoints_status_check
  CHECK (status IN ('COPYING_RAW', 'RAW_STAGED', 'FAILED', 'VERIFICATION_COMPLETE', 'PARTIAL'));

COMMIT;
