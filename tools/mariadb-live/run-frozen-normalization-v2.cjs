'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeAuthoritativeRow } = require('./authoritative-evidence-normalizer.cjs');
const { bindProposalEvidence } = require('./bind-proposal-evidence.cjs');

function normalizeClaim(member) {
  try {
    if (member.raw.source_hash !== member.expected_source_hash) throw Object.assign(new Error(), { code: 'PROVENANCE_FROZEN_HASH_MISMATCH' });
    const proposal = bindProposalEvidence(member.raw, normalizeAuthoritativeRow(member.raw));
    return { raw_row_id: member.raw_row_id, proposal };
  } catch (error) {
    const code = String(error.code || error.message || 'NORMALIZATION_FAILED');
    const provenance = /^(PROVENANCE_|PROPOSAL_)[A-Z0-9_]+$/.test(code);
    return { raw_row_id: member.raw_row_id, outcome: provenance ? 'QUARANTINE' : 'ERROR',
      error_code: provenance ? code.slice(0, 100) : 'NORMALIZATION_FAILED' };
  }
}

async function run(options) {
  const { rpc, jobName, batchSize = 100, maxBatches = Infinity, onProgress = () => {} } = options;
  if (!jobName || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('INVALID_NORMALIZATION_WORKER_CONFIG');
  for (let batch = 0; batch < maxBatches; batch++) {
    const before = await rpc('get_normalization_job_v2', { p_job_name: jobName });
    if (!before) throw new Error('NORMALIZATION_JOB_NOT_FOUND');
    if (before.complete) { onProgress(before); return before; }
    const lease = crypto.randomUUID();
    const members = await rpc('claim_normalization_batch_v2', { p_job_name: jobName, p_lease_id: lease, p_limit: batchSize });
    if (!Array.isArray(members)) throw new Error('INVALID_NORMALIZATION_CLAIM_RESPONSE');
    if (!members.length) {
      const current = await rpc('get_normalization_job_v2', { p_job_name: jobName });
      onProgress(current);
      if (current.complete) return current;
      // Another worker or an unexpired abandoned lease owns the remaining rows.
      await (options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))))(5000);
      continue;
    }
    const results = members.map(normalizeClaim);
    await rpc('complete_normalization_batch_v2', { p_job_name: jobName, p_lease_id: lease, p_results: results });
    const current = await rpc('get_normalization_job_v2', { p_job_name: jobName });
    onProgress(current);
    if (current.complete) return current;
  }
  return rpc('get_normalization_job_v2', { p_job_name: jobName });
}

function createRpc(env) {
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('INVALID_NORMALIZATION_ENDPOINT');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('NORMALIZATION_SERVICE_KEY_MISSING');
  return async (name, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(new URL('/rest/v1/rpc/' + name, url), {
          method: 'POST', signal: AbortSignal.timeout(45000), redirect: 'error',
          headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY },
          body: JSON.stringify(body),
        });
        if (response.ok) return response.json();
        if (response.status !== 429 && response.status < 500) throw Object.assign(new Error('NORMALIZATION_RPC_REJECTED_' + response.status), { permanent: true });
      } catch (error) {
        if (error.permanent) throw error;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    // An uncertain completion is safely replayed from the same durable job.
    throw new Error('NORMALIZATION_RPC_UNAVAILABLE_AFTER_RETRIES');
  };
}

async function main(env = process.env) {
  if (env.WF_NORMALIZATION_EXECUTE !== 'true') throw new Error('NORMALIZATION_EXECUTION_FLAG_REQUIRED');
  if (!env.WF_NORMALIZATION_JOB || !env.WF_NORMALIZATION_PROGRESS_FILE) throw new Error('NORMALIZATION_JOB_AND_PROGRESS_FILE_REQUIRED');
  const progressFile = path.resolve(env.WF_NORMALIZATION_PROGRESS_FILE);
  fs.mkdirSync(path.dirname(progressFile), { recursive: true });
  const onProgress = job => {
    const progress = { job_name: job.job_name, manifest_sha256: job.manifest_sha256,
      expected_rows: job.expected_rows, processed_rows: job.processed_rows, normalized_rows: job.normalized_rows,
      review_rows: job.review_rows, bundle_rows: job.bundle_rows, quarantine_rows: job.quarantine_rows,
      error_rows: job.error_rows, trading_floor_eligible_rows: job.trading_floor_eligible_rows,
      price_research_eligible_rows: job.price_research_eligible_rows, complete: job.complete,
      updated_at: job.updated_at, publication_performed: false };
    fs.writeFileSync(progressFile + '.tmp', JSON.stringify(progress, null, 2));
    fs.renameSync(progressFile + '.tmp', progressFile);
    console.log(JSON.stringify(progress));
  };
  await run({ rpc: createRpc(env), jobName: env.WF_NORMALIZATION_JOB,
    batchSize: env.WF_NORMALIZATION_BATCH_SIZE ? Number(env.WF_NORMALIZATION_BATCH_SIZE) : 100, onProgress });
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'NORMALIZATION_WORKER_FAILED'); process.exitCode = 1;
});
module.exports = { normalizeClaim, run, createRpc };
