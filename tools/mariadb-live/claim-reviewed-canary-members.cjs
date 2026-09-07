'use strict';
const crypto=require('node:crypto');
// Owner-only scheduling of an already reviewed canary within the full sealed
// snapshot job. The caller owns its transaction. No membership is added, and
// existing leases, outcomes, attempt bounds and global counters are preserved.
async function claimReviewedCanaryMembers(db,{jobName,manifestSha256,rawRowIds}){
 if(!jobName||!/^[a-f0-9]{64}$/.test(manifestSha256)||!Array.isArray(rawRowIds)||rawRowIds.length<1||rawRowIds.length>50||new Set(rawRowIds).size!==rawRowIds.length)throw new Error('CANARY_CLAIM_ARGUMENT_INVALID');
 const job=(await db.query(`SELECT j.* FROM wf_canonical_staging.normalization_jobs_v2 j
  JOIN wf_canonical_staging.immutable_source_snapshots s ON s.manifest_sha256=j.immutable_snapshot_sha256
  WHERE j.job_name=$1 AND j.manifest_sha256=$2 AND s.manifest_sha256=$2 AND s.sealed
   AND j.capture_run_key IS NULL AND j.expected_rows=(s.manifest->>'rows')::bigint FOR UPDATE OF j`,[jobName,manifestSha256])).rows[0];
 if(!job)throw new Error('CANARY_CLAIM_SEALED_BOUNDARY_REQUIRED');
 if(!Number.isFinite(Date.parse(job.capture_checkpoint?.started_at)))throw new Error('CANARY_CLAIM_OBSERVATION_TIME_REQUIRED');
 const existing=(await db.query(`SELECT m.raw_row_id,m.outcome FROM wf_canonical_staging.normalization_job_members_v2 m
  JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id AND r.source_hash=m.source_hash
  WHERE m.job_name=$1 AND m.raw_row_id=ANY($2::uuid[]) AND (r.source_system,r.source_database,r.source_table)=($3,$4,$5)`,[jobName,rawRowIds,job.source_system,job.source_database,job.source_table])).rows;
 if(existing.length!==rawRowIds.length)throw new Error('CANARY_CLAIM_EXACT_MEMBERSHIP_REQUIRED');
 const leaseId=crypto.randomUUID();
 await db.query(`UPDATE wf_canonical_staging.normalization_job_members_v2 SET outcome='LEASED',attempts=attempts+1,
  lease_id=$3,lease_expires_at=clock_timestamp()+interval '120 seconds'
  WHERE job_name=$1 AND raw_row_id=ANY($2::uuid[]) AND attempts<3
   AND (outcome='PENDING' OR (outcome='LEASED' AND lease_expires_at<=clock_timestamp()))`,[jobName,rawRowIds,leaseId]);
 const members=(await db.query(`SELECT m.raw_row_id,m.source_hash expected_source_hash,
  to_jsonb(r)||jsonb_build_object('source_created_on',NULL,'captured_at',$3::text) raw
  FROM wf_canonical_staging.normalization_job_members_v2 m JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=m.raw_row_id
  WHERE m.job_name=$1 AND m.lease_id=$2 AND m.outcome='LEASED' ORDER BY m.raw_row_id`,[jobName,leaseId,job.capture_checkpoint.started_at])).rows;
 return {leaseId,members,existingOutcomes:existing.map(m=>m.outcome)};
}
module.exports={claimReviewedCanaryMembers};
