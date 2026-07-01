#!/usr/bin/env node
/**
 * Build lightweight brand/reference index files for Price Research dropdowns.
 * v2: Uses CURSOR-based (keyset) pagination instead of OFFSET pagination.
 *
 * Root cause of v1 failure: OFFSET pagination on Postgres gets progressively
 * slower as offset grows (the DB must scan + discard all preceding rows).
 * Confirmed via direct curl timing: offset=350K took 4s, offset=500K timed
 * out entirely (HTTP 500, statement timeout). The v1 script silently
 * stopped at ~307K rows because fetchPage() threw on the first timeout.
 *
 * Fix: order by id ascending, filter id > last_seen_id each page. This is
 * O(1) per page regardless of depth — no cumulative scan cost.
 *
 * Output (in public/, small — strings only, git-safe):
 *   watchfacts-brand-index.json — { "Rolex": [...refs], ... }
 *   watchfacts-ref-index.json   — [{ref, count}, ...] top 10k by freq
 */

const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

function fetchPage(p) {
  return new Promise((resolve, reject) => {
    https.get(`${SUPABASE_URL}${p}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Building brand/reference index — cursor-based pagination (v2)...');

  const brandIndex = {};
  const refCount = {};
  const PAGE_SIZE = 1000;
  let lastId = '00000000-0000-0000-0000-000000000000';
  let total = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  while (true) {
    let result;
    try {
      result = await fetchPage(
        `/rest/v1/watch_records?select=id,brand,reference&id=gt.${lastId}&order=id.asc&limit=${PAGE_SIZE}`
      );
    } catch (e) {
      consecutiveErrors++;
      console.log(`  Fetch error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${e.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('  Too many consecutive errors, stopping.');
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (result.status !== 200) {
      consecutiveErrors++;
      console.log(`  HTTP ${result.status} at lastId=${lastId} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    consecutiveErrors = 0;

    const batch = result.data;
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const r of batch) {
      const b = r.brand || 'Unknown';
      if (!brandIndex[b]) brandIndex[b] = new Set();
      if (r.reference) {
        brandIndex[b].add(r.reference);
        refCount[r.reference] = (refCount[r.reference] || 0) + 1;
      }
    }

    lastId = batch[batch.length - 1].id;
    total += batch.length;
    if (total % 200000 === 0) console.log(`  ${total.toLocaleString()} rows scanned... (lastId=${lastId})`);

    if (batch.length < PAGE_SIZE) break; // last page
  }

  console.log(`Scanned ${total.toLocaleString()} rows total.`);

  const brandIndexObj = {};
  for (const [b, refs] of Object.entries(brandIndex)) {
    brandIndexObj[b] = [...refs].filter(Boolean).sort();
  }
  fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(brandIndexObj));
  const brandIndexSize = fs.statSync('public/watchfacts-brand-index.json').size;
  console.log(`Brand index: ${Object.keys(brandIndexObj).length} brands, ${(brandIndexSize/1024).toFixed(0)} KB`);

  const topRefs = Object.entries(refCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10000)
    .map(([ref, count]) => ({ ref, count }));
  fs.writeFileSync('public/watchfacts-ref-index.json', JSON.stringify(topRefs));
  const refIndexSize = fs.statSync('public/watchfacts-ref-index.json').size;
  console.log(`Ref index: ${topRefs.length} references, ${(refIndexSize/1024).toFixed(0)} KB`);

  console.log('\n✅ Index build complete.');
}

main().catch(e => {
  console.error('Index build failed:', e.message);
  process.exit(1);
});
