#!/usr/bin/env node
'use strict';
const { parseFull } = require('../api/_lib/parser');
const fs = require('fs');
const readline = require('readline');

const CSV_PATH = '/home/jasme/wf-training-data/labeled_listings.csv';
const OUTPUT_PATH = '/home/jasme/wf/scripts/wts-report-v43.json';
const MAX_ROWS = 5000;

async function main() {
  const rows = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity
  });

  let i = 0;
  for await (const line of rl) {
    if (i === 0) { i++; continue; } // skip header
    if (rows.length >= MAX_ROWS) break;

    // Parse tab-separated, handling quoted fields
    const parts = line.split('\t');
    const title = parts[0].replace(/^"|"$/g, '');
    if (!title || title.length < 3) { i++; continue; }

    const result = parseFull(title);
    rows.push({
      idx: i,
      raw: title.slice(0, 300), // truncate long messages
      brand: result.brand || null,
      ref: result.ref || null,
      verdict: result.verdict || 'APPROVED',
      normRef: result.normRef || null
    });
    i++;
  }

  // Count verdicts
  const counts = {};
  for (const r of rows) {
    counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  }

  const report = {
    generated: new Date().toISOString(),
    parserVersion: '4.3',
    totalProcessed: rows.length,
    verdictCounts: counts,
    rows
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${rows.length} parsed rows to ${OUTPUT_PATH}`);
  console.log('Verdict distribution:');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch(console.error);
