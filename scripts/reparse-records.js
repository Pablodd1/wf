#!/usr/bin/env node
/**
 * reparse-records.js
 *
 * Re-normalize existing watch_records with the fixed parser v3.2.
 * Uses cursor-based pagination to scan all 2.39M records safely.
 *
 * USAGE:
 *   node scripts/reparse-records.js [--dry-run] [--max=N] [--batch-size=N]
 *
 * FLAGS:
 *   --dry-run        Parse + log only, no DB writes
 *   --batch-size N   Records per fetch batch (default 100)
 *   --max N          Stop after N records (for testing)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const TABLE        = 'watch_records';
const PARSER_VERSION = 'v3.2';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const batchArg    = args.find(a => a.startsWith('--batch-size='));
const maxArg      = args.find(a => a.startsWith('--max='));
const BATCH_SIZE  = batchArg ? parseInt(batchArg.split('=')[1]) : 100;
const MAX_RECORDS = maxArg  ? parseInt(maxArg.split('=')[1])  : 0;

// Report file
const REPORT_FILE = path.join(__dirname, 'reparse-records-report.json');

// ─── EXCLUDED BRANDS (from referenceValidator.ts) ──────────────────────────────
const EXCLUDED_BRANDS = new Set([
  'Ferrari','Apple','Mercedes-Benz','Ducati','Coca-Cola','ASICS','Garmin',
  'Fear of God','Birkin','Christian Dior','Dior','Chanel','Gucci','Fendi',
  'Burberry','Bottega Veneta','Chrome Hearts','David Yurman','Fred',
  'FRED','Glenn Spiro','Grassotti','Angela Cummings','Constance',
  'Australian Kangaroo','Czech Leopard','Granat','Bluecroft','Baltic',
  'Beaubleu','Boneta Inc.','BonetaWholesale.com','BT Watches','Buchira',
  'Brickell Watches','ChronoGrid','Depeche','Factory','FIN','BIG','PJ',
  'RX','UN','GOA','E','Used','Unbranded','Branded','037','16613',
  'McLaren','Nike','Kia','Jaguar','Jordan','null','Naked','New Mini',
  'Green tag','Godfather','Diva Dream','ntpt','NTPT','Ntq','NTQ',
  'Prada','PCGS','Rolls','Royal Canadian Mint','Saint Laurent',
  'Icebergad inc','Helead Watches','Bazel Aftermarket','Marco Bicego',
  'Roberto Coin','Parma Giangi','Porsche Design','Meyer','Megasafe',
  'Mavani And Co','Otsuka Lotec','KENIX SZE','Jack Panther',
  'Jacques Estoier','Fabarge','Famulan','Countess','Croton',
  'SNOOPY','Tether','Tahe','Throwin Salt Co.','TraxNYC','Saucony'
]);

// Known garbage reference suffixes/patterns
const GARBAGE_REF_PATTERNS = [
  /NEED|SOLD|TYIA|WHO|PLZ|DM|NIB|PM|PRE|CARD|NO|THKS|THANK|ROSE|HK|REF$/i,
];

function hasGarbageReference(ref) {
  if (!ref) return false;
  const r = String(ref).toUpperCase();
  // Contains garbage words
  if (/\b(NEED|SOLD|TYIA|WHO|PLZ|DM|NIB|PM|PRE|CARD|NO|THKS|THANK|ROSE|HK|REF)\b/.test(r)) return true;
  // Starts with 0
  if (/^0/.test(r)) return true;
  return false;
}

function isExcludedBrand(brand) {
  if (!brand) return false;
  return EXCLUDED_BRANDS.has(brand.trim());
}

// ─── LOAD PARSER ───────────────────────────────────────────────────────────────
const parserPath = path.join(__dirname, '..', 'api', '_lib', 'parser.js');
let parseFull;
try {
  const parser = require(parserPath);
  parseFull = parser.parseFull;
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
  'Accept':        'application/json',
};

async function fetchBatch(lastId, limit) {
  // Cursor-based pagination: order by id.asc, filter id > lastId
  // The id column is mixed format (UUIDs, wa_*, mr_*, prod_*), so we use string comparison
  let url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,raw_message,brand,reference,price_usd,condition,year,source,flags,verdict,confidence&limit=${limit}&order=id.asc`;

  if (lastId !== null && lastId !== undefined) {
    url += `&id=gt.${encodeURIComponent(String(lastId))}`;
  }

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fetch failed: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function updateBatch(updates) {
  // Supabase batch update requires all objects to have the same keys
  // Ensure every update has the same set of keys
  const allKeys = new Set();
  for (const u of updates) {
    Object.keys(u).forEach(k => allKeys.add(k));
  }
  const normalized = updates.map(u => {
    const obj = {};
    for (const k of allKeys) {
      obj[k] = u[k] !== undefined ? u[k] : null;
    }
    return obj;
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(normalized),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Update failed: ${res.status} ${errText}`);
  }
  return true;
}

// ─── DECIDE IF RECORD NEEDS UPDATE ─────────────────────────────────────────────
function shouldUpdate(record, parsed) {
  const oldBrand = record.brand;
  const oldRef   = record.reference;
  const oldPrice = record.price_usd;
  const oldCond  = record.condition;
  const oldYear  = record.year;
  const oldVerdict = record.verdict;

  const newBrand = parsed.brand || null;
  const newRef   = parsed.ref || null;
  const newPrice = parsed.price || null;
  const newCond  = parsed.condition || null;
  const newYear  = parsed.year || null;

  let reasons = [];

  // 0. CATALOG MATCH BOOST: if catalog matched, override to APPROVED
  if (parsed.catalogMatched) {
    reasons.push(`catalog_matched: ${parsed.brand} ${parsed.ref}`);
    return {
      shouldUpdate: true,
      reasons,
      changes: {
        brand: newBrand,
        reference: newRef,
        price_usd: newPrice,
        condition: newCond,
        year: newYear,
        verdict: 'APPROVED',
        confidence: 100,
      }
    };
  }
  if (hasGarbageReference(oldRef) && !hasGarbageReference(newRef)) {
    reasons.push(`garbage_ref_fixed: "${oldRef}" -> "${newRef}"`);
  }

  // 2. Reference starting with 0
  if (oldRef && String(oldRef).startsWith('0') && newRef && !String(newRef).startsWith('0')) {
    reasons.push(`zero_prefix_fixed: "${oldRef}" -> "${newRef}"`);
  }

  // 3. Excluded brand
  if (isExcludedBrand(oldBrand) && !isExcludedBrand(newBrand) && newBrand) {
    reasons.push(`excluded_brand_fixed: "${oldBrand}" -> "${newBrand}"`);
  }

  // 4. Brand was null but now detected
  if (!oldBrand && newBrand) {
    reasons.push(`brand_detected: null -> "${newBrand}"`);
  }

  // 5. Reference was null but now detected
  if (!oldRef && newRef) {
    reasons.push(`ref_detected: null -> "${newRef}"`);
  }

  // 6. Price was null but now detected (and > 0)
  if ((!oldPrice || oldPrice <= 0) && newPrice && newPrice > 0) {
    reasons.push(`price_detected: ${oldPrice} -> ${newPrice}`);
  }

  // 7. Confidence improvement: new parse has more core fields
  const oldCore = [oldBrand, oldRef, oldPrice].filter(Boolean).length;
  const newCore = [newBrand, newRef, newPrice].filter(Boolean).length;
  if (newCore > oldCore) {
    reasons.push(`core_fields_improved: ${oldCore} -> ${newCore}`);
  }

  // 8. Brand changed to a known watch brand (and old was garbage/null)
  if (oldBrand && newBrand && oldBrand !== newBrand && !isExcludedBrand(newBrand)) {
    // Only if old brand looks like garbage or excluded
    if (isExcludedBrand(oldBrand) || oldBrand.length <= 3 || /^\d+$/.test(oldBrand)) {
      reasons.push(`brand_corrected: "${oldBrand}" -> "${newBrand}"`);
    }
  }

  if (reasons.length === 0) return { shouldUpdate: false, reasons: [], changes: {} };

  const changes = {};
  if (newBrand !== oldBrand) changes.brand = newBrand;
  if (newRef !== oldRef) changes.reference = newRef;
  if (newPrice !== oldPrice) changes.price_usd = newPrice;
  if (newCond !== oldCond) changes.condition = newCond;
  if (newYear !== oldYear) changes.year = newYear;

  return { shouldUpdate: true, reasons, changes };
}

// ─── PROCESS ONE RECORD ────────────────────────────────────────────────────────
function processRecord(record) {
  const text = record.raw_message || '';
  if (!text.trim()) return null;

  let parsed;
  try {
    parsed = parseFull(text);
  } catch (e) {
    return { error: e.message, record };
  }
  if (!parsed) return null;

  const decision = shouldUpdate(record, parsed);
  if (!decision.shouldUpdate) return null;

  return {
    id: record.id,
    ...decision.changes,
    parser_version: PARSER_VERSION,
    reprocessed_at: new Date().toISOString(),
    _reasons: decision.reasons,
    _old: {
      brand: record.brand,
      reference: record.reference,
      price_usd: record.price_usd,
      condition: record.condition,
      year: record.year,
    },
    _new: {
      brand: parsed.brand,
      reference: parsed.ref,
      price_usd: parsed.price,
      condition: parsed.condition,
      year: parsed.year,
    },
  };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' WatchFacts Re-parse Records — Parser v3.2');
  console.log(`  Mode:        ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write)'}`);
  console.log(`  Batch size:  ${BATCH_SIZE}`);
  console.log(`  Max records: ${MAX_RECORDS || 'unlimited'}`);
  console.log('════════════════════════════════════════════════════════════\n');

  let lastId = null;
  let batchNum = 0;
  let totalProcessed = 0;
  let totalCandidates = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  const report = {
    startedAt: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    batchSize: BATCH_SIZE,
    maxRecords: MAX_RECORDS || null,
    parserVersion: PARSER_VERSION,
    changes: [],
    stats: {},
  };

  // Sample for first-batch dry-run preview
  let firstBatchSamples = [];

  while (true) {
    batchNum++;
    let records;
    try {
      records = await fetchBatch(lastId, BATCH_SIZE);
    } catch (e) {
      console.error(`\n[fatal] Fetch failed on batch ${batchNum}: ${e.message}`);
      process.exit(1);
    }

    if (!records.length) {
      console.log('\n[done] No more records found.');
      break;
    }

    const candidates = [];
    for (const record of records) {
      totalProcessed++;
      const result = processRecord(record);
      if (result && result.error) {
        totalErrors++;
        continue;
      }
      if (result) {
        totalCandidates++;
        candidates.push(result);
        if (firstBatchSamples.length < 10 && batchNum === 1) {
          firstBatchSamples.push(result);
        }
      }
    }

    // Log progress every 10K rows
    if (totalProcessed % 10000 < BATCH_SIZE) {
      process.stdout.write(`\r[progress] processed=${totalProcessed.toLocaleString()} candidates=${totalCandidates.toLocaleString()} updated=${totalUpdated.toLocaleString()} errors=${totalErrors.toLocaleString()}  `);
    } else {
      process.stdout.write(`\r[batch ${batchNum}] processed=${totalProcessed.toLocaleString()} candidates=${totalCandidates.toLocaleString()}  `);
    }

    // Dry-run: collect report, do not write
    if (DRY_RUN) {
      report.changes.push(...candidates);
    } else {
      // Live mode: batch update
      if (candidates.length > 0) {
        const updates = candidates.map(c => {
          const { _reasons, _old, _new, ...updatePayload } = c;
          return updatePayload;
        });
        try {
          await updateBatch(updates);
          totalUpdated += candidates.length;
        } catch (e) {
          console.error(`\n[error] Batch ${batchNum} update failed: ${e.message}`);
          totalErrors++;
        }
      }
    }

    // Cursor pagination: last record's id
    lastId = records[records.length - 1].id;

    if (MAX_RECORDS && totalProcessed >= MAX_RECORDS) {
      console.log(`\n[done] Reached max ${MAX_RECORDS} records.`);
      break;
    }

    // Short sleep to avoid rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  report.stats = {
    totalProcessed,
    totalCandidates,
    totalUpdated,
    totalErrors,
    finishedAt: new Date().toISOString(),
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log('\n\n════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Total processed:  ${totalProcessed.toLocaleString()}`);
  console.log(`  Update candidates: ${totalCandidates.toLocaleString()}`);
  console.log(`  Actually updated:  ${totalUpdated.toLocaleString()}`);
  console.log(`  Errors:            ${totalErrors.toLocaleString()}`);
  console.log(`  Report saved to:   ${REPORT_FILE}`);
  console.log('════════════════════════════════════════════════════════════');

  if (DRY_RUN && firstBatchSamples.length > 0) {
    console.log('\n─── SAMPLE CHANGES (first batch) ───');
    for (const s of firstBatchSamples) {
      console.log(`\nID: ${s.id}`);
      console.log(`  Reasons: ${s._reasons.join('; ')}`);
      console.log(`  brand:    "${s._old.brand}" -> "${s._new.brand}"`);
      console.log(`  ref:      "${s._old.reference}" -> "${s._new.reference}"`);
      console.log(`  price:    ${s._old.price_usd} -> ${s._new.price_usd}`);
      console.log(`  cond:     "${s._old.condition}" -> "${s._new.condition}"`);
      console.log(`  year:     ${s._old.year} -> ${s._new.year}`);
    }
  }
}

main().catch(e => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
