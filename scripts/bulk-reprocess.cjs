#!/usr/bin/env node
/**
 * bulk-reprocess.cjs
 *
 * ONE-TIME bulk reprocess of ALL watch_records using the current parser.
 * Uses key-set pagination (id > lastId) to process 2.39M records safely
 * without hitting statement timeouts.
 *
 * USAGE:
 *   export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<rotated-key>"
 *   node scripts/bulk-reprocess.cjs
 *
 * FLAGS:
 *   --dry-run        Parse + log only, no DB writes
 *   --batch-size N   Records per batch (default 500)
 *   --max N          Stop after N records (for testing)
 *   --filter Query   Custom PostgREST query filter (e.g. "verdict=eq.HUMAN")
 *
 * PROGRESS:
 *   State is saved to scripts/bulk-reprocess-progress.json
 *   If the script crashes or times out, re-run and it will resume from the last processed ID.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE        = 'watch_records';
const PARSER_VERSION = 'v2.0';

if (!SUPABASE_KEY) {
  console.error('[fatal] SUPABASE_SERVICE_ROLE_KEY env var is required');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your-key>');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const batchArg    = args.find(a => a.startsWith('--batch-size='));
const maxArg      = args.find(a => a.startsWith('--max='));
const filterArg   = args.find(a => a.startsWith('--filter='));
const BATCH_SIZE  = batchArg ? parseInt(batchArg.split('=')[1]) : 500;
const MAX_RECORDS = maxArg  ? parseInt(maxArg.split('=')[1])  : 0;
const FILTER      = filterArg ? filterArg.split('=').slice(1).join('=') : null;

// Progress file for resumable runs
const PROGRESS_FILE = path.join(__dirname, 'bulk-reprocess-progress.json');

// ─── LOAD PARSER ───────────────────────────────────────────────────────────────
const parserPath = path.join(__dirname, '..', 'api', '_lib', 'parser.js');
let parseFull, verdict, toUSD, classifyListingType;
try {
  const parser = require(parserPath);
  parseFull            = parser.parseFull;
  verdict              = parser.verdict;
  toUSD                = parser.toUSD;
  classifyListingType  = parser.classifyListingType;
  console.log(`[parser] Loaded from ${parserPath}`);
} catch (e) {
  console.error('[fatal] Could not load parser:', e.message);
  process.exit(1);
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────────
const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

async function fetchBatch(lastId, limit, filter) {
  // Use key-set pagination (id > lastId) ordered by id.asc
  // This is extremely fast (uses primary key index) and avoids offset timeouts.
  let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,raw_message,brand,reference,verdict,confidence,price_usd,currency,source,created_at&limit=${limit}&order=id.asc`;
  
  if (lastId) {
    url += `&id=gt.${encodeURIComponent(lastId)}`;
  }
  
  if (filter) {
    url += `&${filter}`;
  }

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fetch failed: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function updateBatch(updates) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Update failed: ${res.status} ${errText}`);
  }
  return true;
}

// ─── PROCESS ONE RECORD ────────────────────────────────────────────────────────
function processRecord(record) {
  const text = record.raw_message || '';
  if (!text.trim()) return null;

  let parsed;
  try {
    parsed = parseFull(text);
  } catch (e) {
    return null;
  }
  if (!parsed) return null;

  const v = verdict(parsed);
  const listingType = typeof classifyListingType === 'function'
    ? classifyListingType(text)
    : 'WTS';
  const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : record.price_usd;

  return {
    id:              record.id,
    brand:           parsed.brand   || record.brand,
    reference:       parsed.ref     || record.reference,
    dial_color:      parsed.dial    || null,
    condition:       parsed.condition || null,
    year:            parsed.year    || null,
    price_raw:       parsed.price   || null,
    price_usd:       priceUSD       || null,
    currency:        parsed.currency || record.currency,
    confidence:      parsed.confidence,
    verdict:         v,
    listing_type:    listingType,
    accessories:     parsed.accessories   ? JSON.stringify(parsed.accessories)   : null,
    month_code:      parsed.month_code    || null,
    field_confidence: parsed.field_confidence ? JSON.stringify(parsed.field_confidence) : null,
    processed_at:    new Date().toISOString(),
    parser_version:  PARSER_VERSION,
  };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════');
  console.log(' WatchFacts Bulk Reprocess (Keyset Mode)');
  console.log(`  Parser version: ${PARSER_VERSION}`);
  console.log(`  Batch size:     ${BATCH_SIZE}`);
  console.log(`  Dry run:        ${DRY_RUN}`);
  if (FILTER) console.log(`  Filter:         ${FILTER}`);
  if (MAX_RECORDS) console.log(`  Max records:    ${MAX_RECORDS}`);
  console.log('════════════════════════════════════════════\n');

  // Load progress
  let progress = { lastId: null, processed: 0, errors: 0, startedAt: new Date().toISOString() };
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log(`[progress] Resuming from lastId: "${progress.lastId}" (${progress.processed} records already processed)`);
    } catch (e) {
      console.log('[progress] Starting fresh');
    }
  }

  let lastId   = progress.lastId;
  let batchNum = 0;

  while (true) {
    batchNum++;
    let records;
    try {
      records = await fetchBatch(lastId, BATCH_SIZE, FILTER);
    } catch (e) {
      console.error(`\n[fatal] Fetch failed on batch ${batchNum}: ${e.message}`);
      process.exit(1);
    }

    if (!records.length) {
      console.log('\n[done] No more records found.');
      break;
    }

    process.stdout.write(`\r[batch ${batchNum}] lastId="${lastId || 'start'}" processed=${progress.processed}  `);

    const updates = [];
    for (const record of records) {
      const update = processRecord(record);
      if (update) updates.push(update);
    }

    if (updates.length && !DRY_RUN) {
      try {
        await updateBatch(updates);
        progress.processed += updates.length;
      } catch (e) {
        console.error(`\n[error] Batch ${batchNum} update failed: ${e.message}`);
        progress.errors++;
      }
    } else if (DRY_RUN) {
      progress.processed += updates.length;
      if (batchNum === 1) {
        console.log('\n[dry-run] Sample output (first record):');
        if (updates[0]) console.log(JSON.stringify(updates[0], null, 2));
      }
    }

    // Keep track of the last processed ID in this batch
    lastId = records[records.length - 1].id;
    progress.lastId = lastId;

    // Save progress after every batch
    if (!DRY_RUN) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    }

    if (MAX_RECORDS && progress.processed >= MAX_RECORDS) {
      console.log(`\n[done] Reached max ${MAX_RECORDS} records.`);
      break;
    }

    // Short sleep to prevent hitting database connection limits
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n\n════════════════════════════════════════════');
  console.log(` COMPLETE — ${progress.processed} records processed, ${progress.errors} errors`);
  console.log('════════════════════════════════════════════');

  if (!DRY_RUN) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ ...progress, completedAt: new Date().toISOString() }, null, 2));
  }
}

main().catch(e => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
