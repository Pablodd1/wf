#!/usr/bin/env node
/**
 * generate-corrected-reports.js
 * v4.3
 * 
 * LOCAL DEV TEST VERSION: generates corrected WTS reports from
 * the labeled CSV dataset using parser v4.3. Outputs per-brand
 * TSV files to Windows Desktop.
 *
 * For PRODUCTION use: POST to /api/generate-report which pulls
 * from Supabase live DB, not local CSV.
 *
 * Usage: node scripts/generate-corrected-reports.js
 */

const fs = require('fs');
const path = require('path');
const { parseFull, splitMultiWatch, classifyListingType } = require('../api/_lib/parser');

const LABELED_PATH = '/home/jasme/wf-training-data/labeled_listings.csv';
const DESKTOP_PATH = '/mnt/c/Users/jasme/Desktop';
const MAX_RECORDS = 20000; // Process up to 20K records

// Read and parse CSV
const raw = fs.readFileSync(LABELED_PATH, 'utf8');
const lines = raw.split('\n').slice(1); // skip header

const wtsRecords = [];
const wtbRecords = [];
const taxonomyCounts = {}; // track new v4.3 verdict taxonomy distribution
let multiWatchExpanded = 0;
let totalProcessed = 0;

for (let i = 0; i < Math.min(MAX_RECORDS, lines.length); i++) {
  const line = lines[i];
  if (!line.trim()) continue;

  const cols = line.split('\t');
  if (cols.length < 9) continue;

  const title = cols[0].replace(/^"|"$/g, '');
  
  totalProcessed++;

  // Classify listing type
  const listingType = classifyListingType(title);
  
  // Check for multi-watch and split
  const parts = splitMultiWatch(title);
  
  if (parts.length > 1) {
    // Multi-watch: parse each part separately
    for (const part of parts) {
      const parsed = parseFull(part);
      if (!parsed.brand || !parsed.ref) continue;
      
      const record = buildRecord(part, parsed, listingType, parts.length);
      
      if (listingType === 'WTB') wtbRecords.push(record);
      else wtsRecords.push(record);
      
      multiWatchExpanded++;
      taxonomyCounts[parsed.verdict] = (taxonomyCounts[parsed.verdict] || 0) + 1;
    }
  } else {
    // Single watch
    const parsed = parseFull(title);
    if (!parsed.brand && !parsed.ref) continue;
    
    const record = buildRecord(title, parsed, listingType, 1);
    
    if (listingType === 'WTB') wtbRecords.push(record);
    else wtsRecords.push(record);
    
    taxonomyCounts[parsed.verdict] = (taxonomyCounts[parsed.verdict] || 0) + 1;
  }
}

function buildRecord(rawText, parsed, listingType, partCount) {
  return {
    rawMessage: rawText.substring(0, 300).replace(/[\t\n\r]/g, ' '),
    brand: parsed.brand || '',
    reference: parsed.ref || '',
    dialColor: parsed.dial || '',
    price: parsed.price || '',
    currency: parsed.currency || 'USD',
    condition: parsed.condition || '',
    year: parsed.year || '',
    confidence: parsed.confidence || 0,
    verdict: parsed.verdict || '',
    reviewReason: parsed.reviewReason || '',
    catalogMatched: parsed.catalogMatched ? 'YES' : 'NO',
    listingType: listingType || 'WTS',
    multiWatch: partCount > 1 ? 'YES (' + partCount + ' watches)' : '',
  };
}

// Write TSV files (Excel-compatible)
function writeTSV(records, filename) {
  if (records.length === 0) return;
  
  const headers = Object.keys(records[0]);
  const tsv = [
    headers.join('\t'),
    ...records.map(r => headers.map(h => r[h] || '').join('\t'))
  ].join('\n');
  
  const filepath = path.join(DESKTOP_PATH, filename);
  fs.writeFileSync(filepath, tsv);
  console.log(`  Written: ${filepath} (${records.length} records)`);
}

console.log('═══════════════════════════════════════════════════════');
console.log(' Generating Corrected WTS/WTB Reports — v4.3');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Total processed:      ${totalProcessed.toLocaleString()}`);
console.log(`  Multi-watch expanded: ${multiWatchExpanded}`);
console.log(`  WTS records:          ${wtsRecords.length}`);
console.log(`  WTB records:          ${wtbRecords.length}`);
console.log('');

// ── Taxonomy distribution (v4.3 new) ──
console.log('  Verdict taxonomy distribution:');
Object.entries(taxonomyCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([verdict, count]) => {
    console.log(`    ${verdict}: ${count}`);
  });
console.log('');

// ── WTS by brand ──
const wtsByBrand = {};
for (const r of wtsRecords) {
  const b = r.brand || 'Unknown';
  if (!wtsByBrand[b]) wtsByBrand[b] = [];
  wtsByBrand[b].push(r);
}

console.log('  WTS by brand:');
Object.entries(wtsByBrand)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([brand, records]) => {
    const safeBrand = brand.replace(/[^a-zA-Z0-9]/g, '_');
    writeTSV(records, `WF_WTS_${safeBrand}_corrected.tsv`);
  });

// ── WTB report (placeholder — will follow separate patterns later per Jasmel) ──
writeTSV(wtbRecords, 'WF_WTB_corrected.tsv');

// ── Summary report ──
const summaryReport = {
  generatedAt: new Date().toISOString(),
  parserVersion: 'v4.3',
  totalProcessed,
  multiWatchExpanded,
  wtsRecords: wtsRecords.length,
  wtbRecords: wtbRecords.length,
  taxonomy: taxonomyCounts,
  wtsByBrand: Object.fromEntries(
    Object.entries(wtsByBrand)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, v]) => [k, v.length])
  ),
};

const summaryPath = path.join(DESKTOP_PATH, 'WF_correction_summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
console.log(`\n  Summary: ${summaryPath}`);
console.log('═══════════════════════════════════════════════════════');
