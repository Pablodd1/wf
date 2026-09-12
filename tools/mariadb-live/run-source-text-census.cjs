// tools/mariadb-live/run-source-text-census.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const TARGET_ROW_COUNT = 10000;

async function runCensus(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  console.log('[Census] Fetching 10,000 rows for source-text census...');

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

  console.log('[Census] Analyzing 10,000 rows for nonblank counts and overlaps...');

  let rawMessageNonblank = 0;
  let descriptionNonblank = 0;
  let titleNonblank = 0;
  let commentsNonblank = 0;

  let descOnly = 0;
  let titleOnly = 0;
  let commentsOnly = 0;
  let descAndTitle = 0;
  let descAndComments = 0;
  let titleAndComments = 0;
  let allThree = 0;
  let allThreeBlank = 0;

  let resolvedFromDesc = 0;
  let resolvedFromTitle = 0;
  let resolvedFromComments = 0;
  let unresolvedMissing = 0;

  for (const r of stagedRows) {
    const rawMsg = typeof r.raw_message === 'string' ? r.raw_message.trim() : '';
    const raw = r.raw_payload || {};
    const desc = typeof raw.description === 'string' ? raw.description.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const comments = typeof raw.comments === 'string' ? raw.comments.trim() : '';

    if (rawMsg) rawMessageNonblank++;
    if (desc) descriptionNonblank++;
    if (title) titleNonblank++;
    if (comments) commentsNonblank++;

    const hasD = desc.length > 0;
    const hasT = title.length > 0;
    const hasC = comments.length > 0;

    if (hasD && !hasT && !hasC) descOnly++;
    else if (!hasD && hasT && !hasC) titleOnly++;
    else if (!hasD && !hasT && hasC) commentsOnly++;
    else if (hasD && hasT && !hasC) descAndTitle++;
    else if (hasD && !hasT && hasC) descAndComments++;
    else if (!hasD && hasT && hasC) titleAndComments++;
    else if (hasD && hasT && hasC) allThree++;
    else if (!hasD && !hasT && !hasC) allThreeBlank++;

    // Precedence resolution: description -> title -> comments
    if (hasD) resolvedFromDesc++;
    else if (hasT) resolvedFromTitle++;
    else if (hasC) resolvedFromComments++;
    else unresolvedMissing++;
  }

  const result = {
    total_cohort_rows: stagedRows.length,
    individual_nonblank_counts: {
      raw_message: { count: rawMessageNonblank, pct: ((rawMessageNonblank / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      description: { count: descriptionNonblank, pct: ((descriptionNonblank / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      title: { count: titleNonblank, pct: ((titleNonblank / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      comments: { count: commentsNonblank, pct: ((commentsNonblank / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' }
    },
    venn_overlap_breakdown: {
      description_only: descOnly,
      title_only: titleOnly,
      comments_only: commentsOnly,
      description_and_title: descAndTitle,
      description_and_comments: descAndComments,
      title_and_comments: titleAndComments,
      all_three_present: allThree,
      all_three_blank: allThreeBlank
    },
    precedence_resolution_coverage: {
      resolved_from_description: { count: resolvedFromDesc, pct: ((resolvedFromDesc / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      resolved_from_title: { count: resolvedFromTitle, pct: ((resolvedFromTitle / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      resolved_from_comments: { count: resolvedFromComments, pct: ((resolvedFromComments / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      total_source_text_coverage: { count: (resolvedFromDesc + resolvedFromTitle + resolvedFromComments), pct: (((resolvedFromDesc + resolvedFromTitle + resolvedFromComments) / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' },
      unresolved_missing_source_text: { count: unresolvedMissing, pct: ((unresolvedMissing / TARGET_ROW_COUNT) * 100).toFixed(2) + '%' }
    }
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  runCensus().catch(console.error);
}

module.exports = { runCensus };
