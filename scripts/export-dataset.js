#!/usr/bin/env node
/**
 * Export normalized watch records to static JSON + CSV for instant access.
 * v2: Streams writes to disk incrementally — avoids V8's string length limit
 * that crashed v1 at ~600K records (JSON.stringify() on one giant array).
 *
 * Output files (in public/):
 *   watchfacts-export.json    — Full normalized dataset (streamed NDJSON-in-array)
 *   watchfacts-stats.json     — Aggregated stats (verdict counts, brands, etc)
 *   watchfacts-brand-index.json — brand -> [references] for Price Research
 *   watchfacts-ref-index.json   — top 10k references by frequency
 *
 * Supabase is ONLY used for:
 * - New incoming records (last 24h)
 * - Human-edited records
 * - Write operations
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

function fetchPage(p) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}${p}`;
    https.get(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Parse error: ${e.message} (body head: ${body.substring(0,150)})`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Exporting normalized dataset (v2 — streamed writes)...');

  // 1. Get stats (fast — uses mv_verdict_dist)
  console.log('Fetching stats...');
  const verdictData = await fetchPage('/rest/v1/mv_verdict_dist?select=*');
  const stats = {
    exportDate: new Date().toISOString(),
    total: verdictData.reduce((s, r) => s + r.count, 0),
    totalRecords: verdictData.reduce((s, r) => s + r.count, 0),
    verdictCounts: {},
  };
  verdictData.forEach(r => { stats.verdictCounts[r.verdict] = r.count; });
  fs.writeFileSync('public/watchfacts-stats.json', JSON.stringify(stats, null, 2));
  console.log(`Stats saved: ${stats.total.toLocaleString()} records`);

  // 2. Stream-export all records — write JSON array incrementally to avoid
  // holding 2.4M records + raw_message text in one in-memory string.
  console.log('Exporting full dataset (streamed)...');
  const jsonPath = path.join('public', 'watchfacts-export.json');
  const stream = fs.createWriteStream(jsonPath, { encoding: 'utf8' });
  stream.write('[');

  const PAGE_SIZE = 1000;
  let offset = 0;
  let totalExported = 0;
  let firstRecord = true;

  // Track brand/ref index incrementally (small memory footprint — just strings)
  const brandIndex = {}; // brand -> Set(refs)
  const refCount = {};   // ref -> count

  while (true) {
    const batch = await fetchPage(
      `/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,human_edited,raw_message&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const r of batch) {
      // Truncate raw_message to keep the export file manageable — full text
      // isn't needed for listing/demo display, just a preview.
      if (r.raw_message && r.raw_message.length > 150) {
        r.raw_message = r.raw_message.substring(0, 150);
      }
      if (!firstRecord) stream.write(',');
      firstRecord = false;
      stream.write(JSON.stringify(r));

      const b = r.brand || 'Unknown';
      if (!brandIndex[b]) brandIndex[b] = new Set();
      if (r.reference) {
        brandIndex[b].add(r.reference);
        refCount[r.reference] = (refCount[r.reference] || 0) + 1;
      }
    }

    totalExported += batch.length;
    offset += PAGE_SIZE;
    if (totalExported % 100000 === 0) {
      console.log(`  ${totalExported.toLocaleString()} records exported...`);
    }
    if (offset > 2500000) break; // safety cap
  }

  stream.write(']');
  await new Promise((resolve, reject) => {
    stream.end(err => err ? reject(err) : resolve());
  });
  console.log(`JSON saved: ${jsonPath} (${totalExported.toLocaleString()} records)`);

  // 3. Brand index (small — just brand -> ref list)
  const brandIndexObj = {};
  for (const [b, refs] of Object.entries(brandIndex)) {
    brandIndexObj[b] = [...refs].filter(Boolean).sort();
  }
  fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(brandIndexObj));
  console.log(`Brand index saved: ${Object.keys(brandIndexObj).length} brands`);

  // 4. Reference index for Price Research
  const topRefs = Object.entries(refCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10000)
    .map(([ref, count]) => ({ ref, count }));
  fs.writeFileSync('public/watchfacts-ref-index.json', JSON.stringify(topRefs));
  console.log(`Ref index saved: ${topRefs.length} references`);

  console.log('\n✅ Export complete!');
  console.log(`Total records exported: ${totalExported.toLocaleString()}`);
}

main().catch(e => {
  console.error('Export failed:', e.message);
  process.exit(1);
});
