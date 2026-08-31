// tools/mariadb-live/audit-title-vs-raw-message.cjs
'use strict';

const crypto = require('node:crypto');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const TARGET_ROW_COUNT = 10000;

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

function computeStats(arr) {
  if (!arr.length) return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / sorted.length) * 100) / 100;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / sorted.length;
  const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
  return { min, max, mean, median, stdDev };
}

async function auditTitleComparison(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  console.log('[Audit] Fetching 10,000 canary rows to compare raw_payload.title vs raw_message...');

  const stagedRows = [];
  const seenIds = new Set();
  let lastCreatedOn = null;
  let lastSourceId = null;

  while (stagedRows.length < TARGET_ROW_COUNT) {
    const limit = 1000;
    const body = {
      p_limit: limit,
      p_last_created_on: lastCreatedOn,
      p_last_source_id: lastSourceId
    };

    const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/get_mariadb_private_staged_rows_batch';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: 'Bearer ' + supabaseKey
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('RPC failed (' + res.status + '): ' + (await res.text()));
    const batch = await res.json();
    if (!batch || !batch.length) break;

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      if (r.source_created_on > FROZEN_UPPER_CURSOR.created_on ||
         (r.source_created_on === FROZEN_UPPER_CURSOR.created_on && r.source_id > FROZEN_UPPER_CURSOR.source_id)) {
        continue;
      }
      if (r.source_system !== 'OceanDigital MariaDB' ||
          r.source_database !== 'thecollective_inventory' ||
          r.source_table !== 'auctions') {
        continue;
      }
      if (seenIds.has(r.source_id)) continue;
      seenIds.add(r.source_id);
      stagedRows.push(r);
      if (stagedRows.length === TARGET_ROW_COUNT) break;
    }

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;
  }

  // Filter the rows where raw_message is non-empty
  const populatedRawMsgRows = stagedRows.filter(r => typeof r.raw_message === 'string' && r.raw_message.trim().length > 0);
  console.log('[Audit] Found ' + populatedRawMsgRows.length + ' rows with populated raw_message out of ' + stagedRows.length + ' total.');

  let exactMatches = 0;
  let hashMatches = 0;
  let trimmedMatches = 0;
  let mismatches = [];

  const rawMsgLengths = [];
  const titleLengthsInPopulated = [];
  const allTitleLengths = [];
  let multilineTitles = 0;
  let possibleTruncations = 0;
  const truncationCandidates = [];

  for (const r of stagedRows) {
    const raw = r.raw_payload || {};
    const title = typeof raw.title === 'string' ? raw.title : '';
    allTitleLengths.push(title.length);

    if (title.includes('\n') || title.includes('\r')) {
      multilineTitles++;
    }

    // Check for truncation artifacts
    if (title.endsWith('...') || title.endsWith('\u2026') || title.endsWith('..') || title.length === 255 || title.length === 256) {
      possibleTruncations++;
      if (truncationCandidates.length < 5) {
        truncationCandidates.push({
          source_id: r.source_id,
          length: title.length,
          title_snippet: title.slice(-30)
        });
      }
    }
  }

  for (const r of populatedRawMsgRows) {
    const rawMsg = r.raw_message;
    const raw = r.raw_payload || {};
    const title = typeof raw.title === 'string' ? raw.title : '';

    rawMsgLengths.push(rawMsg.length);
    titleLengthsInPopulated.push(title.length);

    const isExact = rawMsg === title;
    const isHash = sha256(rawMsg) === sha256(title);
    const isTrimmed = rawMsg.trim() === title.trim();

    if (isExact) exactMatches++;
    if (isHash) hashMatches++;
    if (isTrimmed) trimmedMatches++;

    if (!isExact) {
      if (mismatches.length < 5) {
        mismatches.push({
          source_id: r.source_id,
          raw_message_length: rawMsg.length,
          title_length: title.length,
          raw_message_sha: sha256(rawMsg),
          title_sha: sha256(title)
        });
      }
    }
  }

  const report = {
    total_canary_cohort: stagedRows.length,
    populated_raw_message_count: populatedRawMsgRows.length,
    exact_comparison_audit: {
      exact_string_equality_count: exactMatches,
      exact_string_equality_pct: ((exactMatches / populatedRawMsgRows.length) * 100).toFixed(2) + '%',
      sha256_hash_equality_count: hashMatches,
      sha256_hash_equality_pct: ((hashMatches / populatedRawMsgRows.length) * 100).toFixed(2) + '%',
      trimmed_string_equality_count: trimmedMatches,
      trimmed_string_equality_pct: ((trimmedMatches / populatedRawMsgRows.length) * 100).toFixed(2) + '%',
      mismatch_count: populatedRawMsgRows.length - exactMatches
    },
    length_distributions: {
      populated_raw_message_lengths: computeStats(rawMsgLengths),
      populated_title_lengths: computeStats(titleLengthsInPopulated),
      all_10k_title_lengths: computeStats(allTitleLengths)
    },
    multiline_and_truncation_evidence: {
      multiline_titles_count: multilineTitles,
      multiline_titles_pct: ((multilineTitles / stagedRows.length) * 100).toFixed(2) + '%',
      possible_truncation_count: possibleTruncations,
      possible_truncation_pct: ((possibleTruncations / stagedRows.length) * 100).toFixed(2) + '%',
      max_title_length_observed: Math.max(...allTitleLengths),
      truncation_candidates_sample: truncationCandidates
    }
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  auditTitleComparison().catch(console.error);
}

module.exports = { auditTitleComparison };
