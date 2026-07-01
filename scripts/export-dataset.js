#!/usr/bin/env node
/**
 * Export normalized watch records to static JSON + CSV for instant access.
 * Run ONCE after normalization. Serves as the primary data source for:
 * - Trading floor (all 2.39M records)
 * - Admin reports (paginated)
 * - Price research (brand+ref lookups)
 * - Pipeline dashboard (verdict distribution)
 *
 * Output files (in public/):
 *   watchfacts-export.json    — Full normalized dataset
 *   watchfacts-export.csv     — CSV version for Excel
 *   watchfacts-stats.json     — Aggregated stats (verdict counts, brands, etc)
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

function fetchPage(path) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}${path}`;
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
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Exporting normalized dataset...');

  // 1. Get stats (fast — uses mv_verdict_dist)
  console.log('Fetching stats...');
  const verdictData = await fetchPage('/rest/v1/mv_verdict_dist?select=*');
  const stats = {
    exportDate: new Date().toISOString(),
    totalRecords: verdictData.reduce((s, r) => s + r.count, 0),
    verdictCounts: {},
  };
  verdictData.forEach(r => { stats.verdictCounts[r.verdict] = r.count; });
  fs.writeFileSync('public/watchfacts-stats.json', JSON.stringify(stats, null, 2));
  console.log(`Stats saved: ${stats.totalRecords.toLocaleString()} records`);

  // 2. Export all records in chunks (1000 per page, ~2400 pages)
  console.log('Exporting full dataset...');
  const allRecords = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let totalExported = 0;

  while (offset < 2400000) {
    const batch = await fetchPage(
      `/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message,human_edited,parser_version&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    allRecords.push(...batch);
    totalExported += batch.length;
    offset += PAGE_SIZE;
    if (totalExported % 100000 === 0) {
      console.log(`  ${totalExported.toLocaleString()} records exported...`);
    }
  }

  // Save JSON (compressed — minified)
  const jsonPath = path.join('public', 'watchfacts-export.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allRecords));
  console.log(`JSON saved: ${jsonPath} (${allRecords.length.toLocaleString()} records)`);

  // Save CSV
  const csvHeader = 'id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message,human_edited,parser_version\n';
  const csvRows = allRecords.map(r => [
    r.id,
    `"${(r.brand || '').replace(/"/g, '""')}"`,
    `"${(r.reference || '').replace(/"/g, '""')}"`,
    r.dial_color || '',
    r.condition || '',
    r.price_usd || '',
    r.confidence || '',
    r.verdict || '',
    r.source || '',
    r.created_at || '',
    `"${(r.raw_message || '').replace(/"/g, '""').substring(0, 200)}"`,
    r.human_edited ? 'Yes' : 'No',
    r.parser_version || '',
  ].join(','));
  const csvPath = path.join('public', 'watchfacts-export.csv');
  fs.writeFileSync(csvPath, csvHeader + csvRows.join('\n'));
  console.log(`CSV saved: ${csvPath} (${allRecords.length.toLocaleString()} rows)`);

  // 3. Build index files for fast lookup
  // Brand index: { "Rolex": [...refs], "Patek Philippe": [...refs], ... }
  const brandIndex = {};
  const refIndex = {};
  for (const r of allRecords) {
    const b = r.brand || 'Unknown';
    if (!brandIndex[b]) brandIndex[b] = new Set();
    brandIndex[b].add(r.reference);
    if (r.reference) refIndex[r.reference] = (refIndex[r.reference] || 0) + 1;
  }
  const brandIndexObj = {};
  for (const [b, refs] of Object.entries(brandIndex)) {
    brandIndexObj[b] = [...refs].filter(Boolean).sort();
  }
  fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(brandIndexObj));
  console.log(`Brand index saved: ${Object.keys(brandIndexObj).length} brands`);

  // 4. Reference index for Price Research
  const topRefs = Object.entries(refIndex)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10000)
    .map(([ref, count]) => ({ ref, count }));
  fs.writeFileSync('public/watchfacts-ref-index.json', JSON.stringify(topRefs));
  console.log(`Ref index saved: ${topRefs.length} references`);

  console.log('\n✅ Export complete!');
  console.log('Files created:');
  console.log('  public/watchfacts-export.json');
  console.log('  public/watchfacts-export.csv');
  console.log('  public/watchfacts-stats.json');
  console.log('  public/watchfacts-brand-index.json');
  console.log('  public/watchfacts-ref-index.json');
}

main().catch(e => {
  console.error('Export failed:', e.message);
  process.exit(1);
});
