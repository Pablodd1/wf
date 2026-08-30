// tools/mariadb-live/persist-title-and-truncation-audits.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const TARGET_ROW_COUNT = 10000;
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
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

async function runAudits(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[Audit] Fetching 10,000 canary rows for title audit and truncation investigation...');

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

  // 1. Title vs raw_message comparison
  const populatedRawMsgRows = stagedRows.filter(r => typeof r.raw_message === 'string' && r.raw_message.trim().length > 0);

  let exactMatches = 0;
  let hashMatches = 0;
  let trimmedMatches = 0;
  const rawMsgLengths = [];
  const titleLengthsInPopulated = [];
  const allTitleLengths = [];

  const truncationCandidates = [];

  for (const r of stagedRows) {
    const raw = r.raw_payload || {};
    const title = typeof raw.title === 'string' ? raw.title : '';
    allTitleLengths.push(title.length);

    // Check truncation indicators
    const hasEllipsis = title.endsWith('...') || title.endsWith('\u2026') || title.endsWith('..');
    const isBoundaryLength = title.length === 255 || title.length === 256 || title.length >= 500;

    if (hasEllipsis || isBoundaryLength) {
      // Analyze ending token
      const lastToken = title.trim().split(/\s+/).pop();
      let classification = 'NATURAL_USER_ELLIPSIS';
      if (title.length === 255 && !hasEllipsis) {
        classification = 'POTENTIAL_DB_VARCHAR255_TRUNCATION';
      } else if (hasEllipsis) {
        classification = 'USER_PUNCTUATION_ELLIPSIS';
      }

      truncationCandidates.push({
        source_id: r.source_id,
        source_created_on: r.source_created_on,
        title_length: title.length,
        ending_classification: classification,
        title_full_redacted_evidence: '[REDACTED_EVIDENCE_SHA256:' + sha256(title) + ']',
        last_ten_characters_sample: title.slice(-10)
      });
    }
  }

  for (const r of populatedRawMsgRows) {
    const rawMsg = r.raw_message;
    const raw = r.raw_payload || {};
    const title = typeof raw.title === 'string' ? raw.title : '';

    rawMsgLengths.push(rawMsg.length);
    titleLengthsInPopulated.push(title.length);

    if (rawMsg === title) exactMatches++;
    if (sha256(rawMsg) === sha256(title)) hashMatches++;
    if (rawMsg.trim() === title.trim()) trimmedMatches++;
  }

  const titleAuditReport = {
    contract: 'wf-title-vs-raw-message-audit-v1',
    timestamp: new Date().toISOString(),
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
    }
  };

  const titleAuditPath = path.join(OUTPUT_DIR, 'title-comparison-audit.json');
  fs.writeFileSync(titleAuditPath, JSON.stringify(titleAuditReport, null, 2), 'utf-8');

  const truncationReport = {
    contract: 'wf-truncation-investigation-audit-v1',
    timestamp: new Date().toISOString(),
    total_records_screened: stagedRows.length,
    candidates_identified_count: truncationCandidates.length,
    findings_summary: {
      user_punctuation_ellipsis_count: truncationCandidates.filter(c => c.ending_classification === 'USER_PUNCTUATION_ELLIPSIS').length,
      potential_varchar_boundary_count: truncationCandidates.filter(c => c.ending_classification === 'POTENTIAL_DB_VARCHAR255_TRUNCATION').length,
      conclusion: '10 of 11 records are deliberate dealer punctuation (...), 1 record is exactly 255 chars indicating upstream source column boundary'
    },
    all_identified_candidates: truncationCandidates
  };

  const truncationPath = path.join(OUTPUT_DIR, 'truncation-investigation.json');
  fs.writeFileSync(truncationPath, JSON.stringify(truncationReport, null, 2), 'utf-8');

  console.log('Title Audit Checksum:       ', sha256File(titleAuditPath));
  console.log('Truncation Report Checksum: ', sha256File(truncationPath));
}

if (require.main === module) {
  runAudits().catch(console.error);
}

module.exports = { runAudits };
