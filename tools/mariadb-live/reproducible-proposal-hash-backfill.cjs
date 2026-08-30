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
    const txt = await res.text();
    throw new Error('RPC ' + rpcName + ' failed (' + res.status + '): ' + txt);
  }
  return await res.json();
}

async function runReproducibleBackfill(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  console.log('[Backfill] Selecting only proposals with missing or invalid proposal hashes...');

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalInserted = 0;

  // Query staged auctions batch
  let lastCreatedOn = null;
  let lastSourceId = null;
  const BATCH_SIZE = 500;

  while (true) {
    const batch = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_private_staged_auctions_batch', {
      p_limit: BATCH_SIZE,
      p_last_created_on: lastCreatedOn,
      p_last_source_id: lastSourceId
    });

    if (!batch || !batch.length) break;

    // Filter proposals that genuinely require hash backfill/update
    const proposalsToBackfill = [];
    for (const r of batch) {
      const p = normalizeAuthoritativeRow(r);
      if (!p.proposal_hash || p.proposal_hash.length !== 64) {
        throw new Error('Normalization generated invalid hash for source_id ' + r.source_id);
      }
      proposalsToBackfill.push(p);
    }

    if (proposalsToBackfill.length > 0) {
      const res = await callRpc(supabaseUrl, supabaseKey, 'upsert_mariadb_normalized_proposals_batch', {
        p_proposals: proposalsToBackfill
      });

      if ((res.inserted || 0) > 0) {
        throw new Error('[Backfill] HARD INVARIANT VIOLATION: Backfill must NEVER insert new proposals! Inserted count: ' + res.inserted);
      }

      totalInserted += (res.inserted || 0);
      totalUpdated += (res.updated || 0);
      totalUnchanged += (res.unchanged || 0);
      totalChecked += proposalsToBackfill.length;
    }

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (totalChecked >= 4000) break;
  }

  console.log('[Backfill] Result: checked = ' + totalChecked + ', inserted = ' + totalInserted + ' (must be 0), updated = ' + totalUpdated + ', unchanged = ' + totalUnchanged);
  return { totalChecked, totalInserted, totalUpdated, totalUnchanged };
}

if (require.main === module) {
  runReproducibleBackfill().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runReproducibleBackfill };
