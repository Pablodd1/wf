#!/usr/bin/env node
/**
 * bundle-report.js v2 — proper variable scoping
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const OUT = '/mnt/c/Users/jasme/Downloads';

const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

console.log(`Scanning ${files.length} brand files...`);

const detailRows = [];
const summaryMap = {};

for (const file of files) {
  const brand = file.replace('WF_WTS_', '').replace('_corrected.tsv', '').replace(/_/g, ' ');
  const lines = fs.readFileSync(path.join(DESKTOP, file), 'utf8').split('\n');
  const header = lines[0].split('\t');

  let brandBundles = 0;
  let correctlySplit = 0;
  let partiallySplit = 0;
  let notSplit = 0;
  let falsePositives = 0;
  let totalWatches = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

    if (row.verdict !== 'MULTI_WATCH_STOCK_LIST') continue;

    brandBundles++;
    const raw = row.raw_message || '';

    // Count probable refs in the raw message
    const refPattern = /\b\d{5,6}[A-Z]?\b/gi;
    const matches = raw.match(refPattern) || [];
    const watchCount = matches.filter(m => !/\d{5,6}00$/.test(m)).length;
    totalWatches += watchCount;

    const isFalsePositive = watchCount < 2 && raw.length < 100;

    if (isFalsePositive) falsePositives++;
    else if (watchCount === 0) notSplit++;
    else if (watchCount < 5) partiallySplit++;
    else correctlySplit++;

    detailRows.push({
      file: brand,
      raw_snippet: raw.substring(0, 150),
      probable_watch_count: watchCount,
      needs_review: watchCount < 3,
    });
  }

  if (brandBundles > 0) {
    summaryMap[brand] = {
      total_bundles: brandBundles,
      correctly_split: correctlySplit,
      partially_split: partiallySplit,
      not_split: notSplit,
      false_positives: falsePositives,
      avg_watches: brandBundles > 0 ? (totalWatches / brandBundles).toFixed(1) : 0,
    };
  }
}

// Save detail
const detailWS = XLSX.utils.json_to_sheet(detailRows);
const detailWB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(detailWB, detailWS, 'Bundle Detail');
XLSX.writeFile(detailWB, path.join(OUT, 'WF_BUNDLES_detail.xlsx'));

// Save summary
const summaryRows = Object.entries(summaryMap).map(([b, d]) => ({ brand: b, ...d }));
const summaryWS = XLSX.utils.json_to_sheet(summaryRows);
const summaryWB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(summaryWB, summaryWS, 'Bundle Summary');
XLSX.writeFile(summaryWB, path.join(OUT, 'WF_BUNDLES_summary.xlsx'));

console.log(`Done — ${detailRows.length} detail rows, ${summaryRows.length} brands summarized.`);
