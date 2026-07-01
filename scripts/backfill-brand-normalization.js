#!/usr/bin/env node
/**
 * Brand Normalization Backfill — applies canonical brand mapping to the DB.
 *
 * REQUIRES explicit user approval before running (destructive DB write,
 * per project convention). This script only UPDATEs brand/flags fields —
 * never deletes rows.
 *
 * What it does per matched brand alias (e.g. "Bvlgari" -> "Bulgari"):
 *   UPDATE watch_records SET brand = 'Bulgari', human_edited = false,
 *     edit_source = 'brand_normalization_v1'
 *   WHERE brand = 'Bvlgari'
 *
 * For non-watch brands (e.g. "Apple", "Ferrari"): sets a flag for human
 * review, does NOT change the brand or verdict — a human should look at
 * these individually since they might be legitimate accessory listings.
 *
 * For garbage brands (e.g. "037", "E", "Used"): sets brand = NULL so the
 * record can be re-parsed/re-reviewed — these are parser failures, not
 * real data, so leaving a fake brand string is worse than null.
 *
 * Run with --dry-run (default) to preview without writing.
 * Run with --apply to actually execute the UPDATE statements.
 */

const fs = require('fs');
const https = require('https');
const { normalizeBrand } = require('../api/_lib/brand-normalizer');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

const APPLY = process.argv.includes('--apply');

function patchRequest(pathQuery, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}${pathQuery}`);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Prefer': 'return=minimal',
      },
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY RUN (no writes)'}`);
  console.log('');

  const brandIndex = JSON.parse(fs.readFileSync('public/watchfacts-brand-index.json', 'utf8'));

  const mergeOps = [];   // { rawBrand, canonical, refCount }
  const nullOps = [];    // { rawBrand, refCount }  (garbage)
  const flagOps = [];    // { rawBrand, refCount }  (non-watch, flag only)

  for (const [rawBrand, refs] of Object.entries(brandIndex)) {
    const refCount = refs.length;
    const result = normalizeBrand(rawBrand);
    if (result.category === 'matched') {
      mergeOps.push({ rawBrand, canonical: result.canonical, refCount });
    } else if (result.category === 'garbage') {
      nullOps.push({ rawBrand, refCount });
    } else if (result.category === 'non_watch') {
      flagOps.push({ rawBrand, refCount });
    }
    // 'already_canonical' and 'unmatched' — no action needed
  }

  console.log(`Planned operations:`);
  console.log(`  Merge (brand rename):     ${mergeOps.length} distinct raw values`);
  console.log(`  Null out (garbage):       ${nullOps.length} distinct raw values`);
  console.log(`  Flag for review (non-watch): ${flagOps.length} distinct raw values`);
  console.log('');

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const { rawBrand, canonical, refCount } of mergeOps) {
    const encodedBrand = encodeURIComponent(rawBrand);
    const query = `/rest/v1/watch_records?brand=eq.${encodedBrand}`;
    const body = { brand: canonical, edit_source: 'brand_normalization_v1' };

    if (!APPLY) {
      console.log(`[DRY] Would UPDATE brand='${rawBrand}' -> '${canonical}' (~${refCount} refs, records may be more since refs are distinct-per-brand not row-count)`);
      continue;
    }

    try {
      const res = await patchRequest(query, body);
      if (res.status >= 200 && res.status < 300) {
        console.log(`✅ '${rawBrand}' -> '${canonical}'`);
        totalUpdated++;
      } else {
        console.log(`❌ '${rawBrand}' -> '${canonical}': HTTP ${res.status} ${res.body.substring(0, 150)}`);
        totalErrors++;
      }
    } catch (e) {
      console.log(`❌ '${rawBrand}': ${e.message}`);
      totalErrors++;
    }
  }

  for (const { rawBrand, refCount } of nullOps) {
    const encodedBrand = encodeURIComponent(rawBrand);
    const query = `/rest/v1/watch_records?brand=eq.${encodedBrand}`;
    const body = { brand: null, flags: { garbage_brand_nulled: rawBrand } };

    if (!APPLY) {
      console.log(`[DRY] Would NULL brand='${rawBrand}' (~${refCount} refs) — flagged garbage_brand_nulled`);
      continue;
    }

    try {
      const res = await patchRequest(query, body);
      if (res.status >= 200 && res.status < 300) {
        console.log(`✅ NULLed brand='${rawBrand}'`);
        totalUpdated++;
      } else {
        console.log(`❌ NULL '${rawBrand}': HTTP ${res.status} ${res.body.substring(0, 150)}`);
        totalErrors++;
      }
    } catch (e) {
      console.log(`❌ NULL '${rawBrand}': ${e.message}`);
      totalErrors++;
    }
  }

  for (const { rawBrand, refCount } of flagOps) {
    const encodedBrand = encodeURIComponent(rawBrand);
    const query = `/rest/v1/watch_records?brand=eq.${encodedBrand}`;
    const body = { flags: { non_watch_brand: rawBrand, needs_review: true } };

    if (!APPLY) {
      console.log(`[DRY] Would FLAG brand='${rawBrand}' (~${refCount} refs) for human review — brand NOT changed`);
      continue;
    }

    try {
      const res = await patchRequest(query, body);
      if (res.status >= 200 && res.status < 300) {
        console.log(`✅ Flagged brand='${rawBrand}' for review`);
        totalUpdated++;
      } else {
        console.log(`❌ FLAG '${rawBrand}': HTTP ${res.status} ${res.body.substring(0, 150)}`);
        totalErrors++;
      }
    } catch (e) {
      console.log(`❌ FLAG '${rawBrand}': ${e.message}`);
      totalErrors++;
    }
  }

  console.log('');
  if (!APPLY) {
    console.log('This was a DRY RUN. Re-run with --apply to write changes.');
  } else {
    console.log(`Applied: ${totalUpdated} brand-value groups updated, ${totalErrors} errors.`);
  }
}

main().catch(e => {
  console.error('Backfill failed:', e.message);
  process.exit(1);
});
