#!/usr/bin/env node
/**
 * bulk-reprocess.cjs
 *
 * ONE-TIME bulk reprocess of ALL watch_records using the current parser.
 * Run this once after a parser upgrade. Never run again unless the parser
 * has a major update.
 *
 * USAGE:
 *   export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<rotated-key>"
 *   node scripts/bulk-reprocess.cjs
 *
 * FLAGS:
 *   --dry-run        Parse + log only, no DB writes
 *   --batch-size N   Records per batch (default 500)
 *   --start-offset N Resume from offset N (for restarts)
 *   --filter verdict=HUMAN  Only reprocess specific verdicts
 *   --max N          Stop after N records (for testing)
 *
 * PROGRESS:
 *   State is saved to scripts/bulk-reprocess-progress.json
 *   If the script crashes, re-run and it will resume from where it left off.
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
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your-rotated-key>');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const batchArg    = args.find(a => a.startsWith('--batch-size='));
const maxArg      = args.find(a => a.startsWith('--max='));
const offsetArg   = args.find(a => a.startsWith('--start-offset='));
const filterArg   = args.find(a => a.startsWith('--filter='));
const BATCH_SIZE  = batchArg ? parseInt(batchArg.split('=')[1]) : 500;
const MAX_RECORDS = maxArg  ? parseInt(maxArg.split('=')[1])  : 0;
const START_OFFSET= offsetArg ? parseInt(offsetArg.split('=')[1]) : null;
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

async function fetchBatch(offset, limit, filter) {
  let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,raw_message,brand,reference,verdict,confidence,price_usd,currency,source,created_at&limit=${limit}&offset=${offset}&order=created_at.asc`;
  if (filter) {
    // e.g. filter="verdict=eq.HUMAN" or "parser_version=eq.v1"
    url += `&${filter}`;
  } else {
    // Default: only records not yet processed with this parser version
    url += `&parser_version=neq.${PARSER_VERSION}`;
  }
  const res = await fetch(url, { headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': `${offset}-${offset + limit - 1}` } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  const total = parseInt((res.headers.get('content-range') || '0/0').split('/')[1] || '0');
  return { records: await res.json(), total };
}

async function updateBatch(updates) {
  // Batch PATCH via upsert with ON CONFLICT
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
  console.log(' WatchFacts Bulk Reprocess');
  console.log(`  Parser version: ${PARSER_VERSION}`);
  console.log(`  Batch size:     ${BATCH_SIZE}`);
  console.log(`  Dry run:        ${DRY_RUN}`);
  console.log(`  Filter:         ${FILTER || 'parser_version != v2.0'}`);
  if (MAX_RECORDS) console.log(`  Max records:    ${MAX_RECORDS}`);
  console.log('════════════════════════════════════════════\n');

  // Load or init progress
  let progress = { offset: 0, processed: 0, errors: 0, startedAt: new Date().toISOString() };
  if (START_OFFSET !== null) {
    progress.offset = START_OFFSET;
    console.log(`[progress] Resuming from offset ${START_OFFSET}`);
  } else if (fs.existsSync(PROGRESS_FILE)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log(`[progress] Resuming from offset ${progress.offset} (${progress.processed} already processed)`);
    } catch (e) {
      console.log('[progress] Starting fresh');
    }
  }

  let totalKnown = 0;
  let offset     = progress.offset;
  let batchNum   = 0;

  while (true) {
    batchNum++;
    const { records, total } = await fetchBatch(offset, BATCH_SIZE, FILTER);
    if (!totalKnown && total) totalKnown = total;

    if (!records.length) {
      console.log('\n[done] No more records to process.');
      break;
    }

    const pct = totalKnown ? ((progress.processed / totalKnown) * 100).toFixed(1) : '?';
    process.stdout.write(`\r[batch ${batchNum}] offset=${offset} processed=${progress.processed}/${totalKnown} (${pct}%)  `);

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
        console.error(`\n[error] Batch ${batchNum}: ${e.message}`);
        progress.errors++;
        // Continue — don't stop on a single failed batch
      }
    } else if (DRY_RUN) {
      progress.processed += updates.length;
      if (batchNum === 1) {
        console.log('\n[dry-run] Sample output (first 3):');
        updates.slice(0, 3).forEach(u => console.log(JSON.stringify(u, null, 2)));
      }
    }

    offset += BATCH_SIZE;
    progress.offset = offset;

    // Save progress after every batch
    if (!DRY_RUN) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    }

    if (MAX_RECORDS && progress.processed >= MAX_RECORDS) {
      console.log(`\n[done] Reached max ${MAX_RECORDS} records.`);
      break;
    }

    // Small delay to avoid rate limiting Supabase REST API
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
