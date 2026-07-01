#!/usr/bin/env node
/**
 * Get ACCURATE row-count impact (not distinct-ref estimates) for the
 * planned brand normalization operations. Read-only — uses count=exact
 * on brand=eq.X queries, which are fast (filtered, hits an index) unlike
 * unfiltered full-table counts which time out.
 */
const fs = require('fs');
const https = require('https');
const { normalizeBrand } = require('../api/_lib/brand-normalizer');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

function countRows(brand) {
  return new Promise((resolve, reject) => {
    const q = `/rest/v1/watch_records?select=id&brand=eq.${encodeURIComponent(brand)}&limit=1`;
    https.get(`${SUPABASE_URL}${q}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' }
    }, res => {
      const range = res.headers['content-range'] || '0-0/0';
      const total = parseInt(range.split('/')[1] || '0');
      res.on('data', () => {});
      res.on('end', () => resolve(total));
    }).on('error', reject);
  });
}

async function main() {
  const brandIndex = JSON.parse(fs.readFileSync('public/watchfacts-brand-index.json', 'utf8'));
  const ops = [];
  for (const rawBrand of Object.keys(brandIndex)) {
    const result = normalizeBrand(rawBrand);
    if (result.category === 'matched' || result.category === 'garbage' || result.category === 'non_watch') {
      ops.push({ rawBrand, category: result.category, canonical: result.canonical });
    }
  }

  console.log(`Getting accurate row counts for ${ops.length} brand values (this may take a minute)...\n`);

  let totalMerge = 0, totalNull = 0, totalFlag = 0;
  const results = [];

  for (const op of ops) {
    const count = await countRows(op.rawBrand);
    results.push({ ...op, rowCount: count });
    if (op.category === 'matched') totalMerge += count;
    else if (op.category === 'garbage') totalNull += count;
    else if (op.category === 'non_watch') totalFlag += count;
  }

  console.log('═'.repeat(70));
  console.log('ACCURATE ROW-COUNT IMPACT (actual DB rows, not distinct refs)');
  console.log('═'.repeat(70));
  console.log(`Merge (brand rename):        ${totalMerge.toLocaleString()} rows`);
  console.log(`Null out (garbage):          ${totalNull.toLocaleString()} rows`);
  console.log(`Flag for review (non-watch): ${totalFlag.toLocaleString()} rows`);
  console.log(`TOTAL ROWS TOUCHED:          ${(totalMerge + totalNull + totalFlag).toLocaleString()} / 2,392,784 (${((totalMerge+totalNull+totalFlag)/2392784*100).toFixed(3)}%)`);
  console.log();
  console.log('Top 15 by row impact:');
  results.sort((a, b) => b.rowCount - a.rowCount).slice(0, 15).forEach(r => {
    console.log(`  ${r.rowCount.toString().padStart(6)} rows  [${r.category}]  "${r.rawBrand}"${r.canonical ? ` -> "${r.canonical}"` : ''}`);
  });
}

main().catch(e => { console.error(e.message); process.exit(1); });
