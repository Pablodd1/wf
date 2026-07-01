#!/usr/bin/env node
/**
 * Build lightweight brand/reference index files for Price Research dropdowns.
 * These are SMALL (just distinct strings, not full records) — safe for git
 * and Vercel's public/ static assets.
 *
 * Does NOT dump the full 2.39M-record table (that was the v1/v2 mistake —
 * ~478MB, breaks GitHub's 100MB limit and Vercel bundle size limits).
 *
 * Output:
 *   public/watchfacts-brand-index.json — { "Rolex": [...refs], ... }
 *   public/watchfacts-ref-index.json   — [{ref, count}, ...] top 10k by freq
 *   public/watchfacts-stats.json       — verdict counts (already exists)
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
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Building brand/reference index (lightweight — strings only)...');

  const brandIndex = {};   // brand -> Set(refs)
  const refCount = {};     // ref -> count
  const PAGE_SIZE = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    const batch = await fetchPage(
      `/rest/v1/watch_records?select=brand,reference&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const r of batch) {
      const b = r.brand || 'Unknown';
      if (!brandIndex[b]) brandIndex[b] = new Set();
      if (r.reference) {
        brandIndex[b].add(r.reference);
        refCount[r.reference] = (refCount[r.reference] || 0) + 1;
      }
    }

    total += batch.length;
    offset += PAGE_SIZE;
    if (total % 200000 === 0) console.log(`  ${total.toLocaleString()} rows scanned...`);
    if (offset > 2500000) break;
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

  console.log('\n✅ Index build complete (git-safe, no full-record dump).');
}

main().catch(e => {
  console.error('Index build failed:', e.message);
  process.exit(1);
});
