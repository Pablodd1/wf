// tools/mariadb-live/reproducible-proposal-hash-backfill.cjs
'use strict';

const { normalizeAuthoritativeRow, computeProposalHash } = require('./authoritative-evidence-normalizer.cjs');

async function callRpc(supabaseUrl, supabaseKey, rpcName, body) {
  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + rpcName;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('Backfill RPC failed (' + res.status + ')');
  }
  return await res.json();
}

async function runReproducibleBackfill(env = process.env, dependencies = {}) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  const callRpcFn = dependencies.callRpc || callRpc;

  console.log('[Backfill] Selecting only proposals with missing or invalid proposal hashes...');

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalMissing = 0;
  let totalInserted = 0;

  const BATCH_SIZE = 500;

  while (true) {
    const batch = await callRpcFn(supabaseUrl, supabaseKey, 'get_mariadb_proposals_missing_or_invalid_hash', {
      p_limit: BATCH_SIZE
    });

    if (!Array.isArray(batch)) {
      throw new Error('[Backfill] Selection RPC must return an array');
    }
    if (batch.length === 0) break;

    const hashesToBackfill = batch.map(r => {
      const p = normalizeAuthoritativeRow(r);
      // A hash-only repair cannot silently upgrade the stored parser or facts.
      // The database also compares the entire selected row under a write lock.
      const stored = r.stored_proposal;
      if (!stored || computeProposalHash(stored) !== p.proposal_hash) {
        throw new Error('BACKFILL_RENORMALIZATION_REQUIRED');
      }
      if (!/^[0-9a-f]{64}$/.test(p.proposal_hash || '')) {
        throw new Error('BACKFILL_INVALID_GENERATED_HASH');
      }
      return {
        source_system: p.source_system,
        source_database: p.source_database,
        source_table: p.source_table,
        source_id: p.source_id,
        source_hash: p.source_hash,
        proposal_hash: p.proposal_hash,
        expected_stored_proposal: stored
      };
    });

    const res = await callRpcFn(supabaseUrl, supabaseKey, 'backfill_mariadb_proposal_hashes', {
      p_hashes: hashesToBackfill
    });
    const inserted = Number(res && res.inserted);
    if (!Number.isSafeInteger(inserted) || inserted !== 0) {
      throw new Error('[Backfill] HARD INVARIANT VIOLATION: Backfill requires inserted=0; received ' + String(res && res.inserted));
    }

    const updated = Number(res.updated || 0);
    const missing = Number(res.missing || 0);
    if (!Number.isSafeInteger(updated) || !Number.isSafeInteger(missing) || updated + missing !== batch.length) {
      throw new Error('[Backfill] RPC reconciliation failed for selected hash rows');
    }
    if (missing !== 0 || updated === 0) {
      throw new Error('[Backfill] Selected rows were not updated exactly once; missing=' + missing + ', updated=' + updated);
    }

    totalInserted += inserted;
    totalUpdated += updated;
    totalMissing += missing;
    totalChecked += batch.length;
  }

  console.log('[Backfill] Result: checked = ' + totalChecked + ', inserted = ' + totalInserted + ' (required 0), updated = ' + totalUpdated + ', missing = ' + totalMissing);
  return { totalChecked, totalInserted, totalUpdated, totalMissing };
}

if (require.main === module) {
  runReproducibleBackfill().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runReproducibleBackfill };
