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

  console.log('[Backfill] Starting deterministic proposal hash backfill & validation...');

  let lastCreatedOn = null;
  let lastSourceId = null;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalInserted = 0;

  const BATCH_SIZE = 500;
  while (true) {
    const batch = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_private_staged_auctions_batch', {
      p_limit: BATCH_SIZE,
      p_last_created_on: lastCreatedOn,
      p_last_source_id: lastSourceId
    });

    if (!batch || !batch.length) break;

    const proposals = [];
    for (const r of batch) {
      const p = normalizeAuthoritativeRow(r);
      proposals.push(p);
    }

    const res = await callRpc(supabaseUrl, supabaseKey, 'upsert_mariadb_normalized_proposals_batch', {
      p_proposals: proposals
    });

    totalInserted += (res.inserted || 0);
    totalUpdated += (res.updated || 0);
    totalUnchanged += (res.unchanged || 0);
    totalProcessed += batch.length;

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (totalProcessed >= 4000) break;
  }

  console.log('[Backfill] Complete: processed = ' + totalProcessed + ', inserted = ' + totalInserted + ', updated = ' + totalUpdated + ', unchanged = ' + totalUnchanged);
}

if (require.main === module) {
  runReproducibleBackfill().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runReproducibleBackfill };
