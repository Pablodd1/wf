#!/usr/bin/env node
/**
 * generate-corrected-reports.js
 * 
 * Generates corrected WTS and WTB Excel reports using the improved
 * parser v4.1 against the labeled listings dataset.
 * 
 * Output: Per-brand Excel files with corrected data, saved to Desktop.
 */

const fs = require('fs');
const path = require('path');
const { parseFull, splitMultiWatch, classifyListingType } = require('../api/_lib/parser');

const LABELED_PATH = '/home/jasme/wf-training-data/labeled_listings.csv';
const DESKTOP_PATH = '/mnt/c/Users/jasme/Desktop';
const MAX_RECORDS = 10000; // Process up to 10K records

// Read and parse CSV
const raw = fs.readFileSync(LABELED_PATH, 'utf8');
const lines = raw.split('\n').slice(1); // skip header

const wtsRecords = [];
const wtbRecords = [];
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
      
      const record = {
        rawMessage: part.substring(0, 200),
        brand: parsed.brand || '',
        reference: parsed.ref || '',
        dialColor: parsed.dial || '',
        price: parsed.price || '',
        currency: parsed.currency || 'USD',
        condition: parsed.condition || '',
        year: parsed.year || '',
        confidence: parsed.confidence || 0,
        verdict: parsed.verdict || '',
        catalogMatched: parsed.catalogMatched ? 'YES' : 'NO',
        listingType: listingType,
        multiWatch: 'YES (' + parts.length + ' watches)',
      };
      
      if (listingType === 'WTB') wtbRecords.push(record);
      else wtsRecords.push(record);
      
      multiWatchExpanded++;
    }
  } else {
    // Single watch
    const parsed = parseFull(title);
    if (!parsed.brand && !parsed.ref) continue;
    
    const record = {
      rawMessage: title.substring(0, 200),
      brand: parsed.brand || '',
      reference: parsed.ref || '',
      dialColor: parsed.dial || '',
      price: parsed.price || '',
      currency: parsed.currency || 'USD',
      condition: parsed.condition || '',
      year: parsed.year || '',
      confidence: parsed.confidence || 0,
      verdict: parsed.verdict || '',
      catalogMatched: parsed.catalogMatched ? 'YES' : 'NO',
      listingType: listingType,
      multiWatch: '',
    };
    
    if (listingType === 'WTB') wtbRecords.push(record);
    else wtsRecords.push(record);
  }
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
console.log(' Generating Corrected WTS/WTB Reports');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Total processed:     ${totalProcessed.toLocaleString()}`);
console.log(`  Multi-watch expanded:${multiWatchExpanded}`);
console.log(`  WTS records:         ${wtsRecords.length}`);
console.log(`  WTB records:         ${wtbRecords.length}`);
console.log('');

// Group by brand for WTS
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

// WTB report
writeTSV(wtbRecords, 'WF_WTB_corrected.tsv');

// Summary report with all corrections
const summaryReport = {
  generatedAt: new Date().toISOString(),
  parserVersion: 'v4.1',
  totalProcessed,
  multiWatchExpanded,
  wtsRecords: wtsRecords.length,
  wtbRecords: wtbRecords.length,
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
