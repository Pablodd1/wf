#!/usr/bin/env node
/**
 * REPARSE: Re-runs parser v4.4 on the Desktop TSV files (rawMessage column)
 * Fixes: dialColor None, price None, condition None
 * Output: Updated TSV files (in-place) + regenerated Excel
 */

const fs = require('fs');
const path = require('path');

// Dynamically import parser (works with both ESM and CommonJS)
let parser;
try {
  // Try direct require
  parser = require('../api/_lib/parser');
} catch (e) {
  // Fall back to import for ESM modules
  const { parseWatch } = require('../api/_lib/parser');
  parser = { parseWatch };
}

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_') && f.endsWith('_corrected.tsv'));
console.log(`Re-parsing ${files.length} TSV files with parser v4.4...\n`);

files.forEach(file => {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  
  // Find rawMessage column index
  const rawMsgIdx = header.findIndex(h => h === 'rawMessage' || h === 'raw_message' || h === 'RAW_MESSAGE');
  if (rawMsgIdx === -1) {
    console.log(`  SKIP ${file}: no rawMessage column`);
    return;
  }
  
  const updatedLines = [header.join('\t')];
  let fixedCount = 0;
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const rawMessage = cols[rawMsgIdx];
    if (!rawMessage) {
      updatedLines.push(lines[i]);
      continue;
    }
    
    try {
      // Run parser v4.4
      const parsed = parser.parseWatch(rawMessage);
      
      // Update columns with parser output
      const brandIdx = header.findIndex(h => h === 'brand');
      const refIdx = header.findIndex(h => h === 'reference');
      const dialIdx = header.findIndex(h => h === 'dialColor' || h === 'dial_color');
      const priceIdx = header.findIndex(h => h === 'price' || h === 'price_usd');
      const condIdx = header.findIndex(h => h === 'condition');
      const yearIdx = header.findIndex(h => h === 'year');
      const confIdx = header.findIndex(h => h === 'confidence');
      const verdictIdx = header.findIndex(h => h === 'verdict');
      const currIdx = header.findIndex(h => h === 'currency');
      
      // Only update if parser found something
      if (parsed.brand && parsed.brand !== 'Unknown' && brandIdx !== -1) cols[brandIdx] = parsed.brand;
      if (parsed.reference && refIdx !== -1) cols[refIdx] = parsed.reference;
      if (parsed.dialColor && dialIdx !== -1) { cols[dialIdx] = parsed.dialColor; fixedCount++; }
      if (parsed.price && priceIdx !== -1 && !cols[priceIdx]) { cols[priceIdx] = parsed.price; fixedCount++; }
      if (parsed.condition && condIdx !== -1 && !cols[condIdx]) { cols[condIdx] = parsed.condition; fixedCount++; }
      if (parsed.year && yearIdx !== -1 && !cols[yearIdx]) { cols[yearIdx] = parsed.year; fixedCount++; }
      if (parsed.confidence && confIdx !== -1) cols[confIdx] = parsed.confidence;
      if (parsed.verdict && verdictIdx !== -1) cols[verdictIdx] = parsed.verdict;
      if (parsed.currency && currIdx !== -1 && !cols[currIdx]) cols[currIdx] = parsed.currency;
      
    } catch (e) {
      // Parser failed — keep original line
    }
    
    updatedLines.push(cols.join('\t'));
  }
  
  fs.writeFileSync(filePath, updatedLines.join('\n') + '\n');
  console.log(`  ✓ ${file}: ${fixedCount} fields fixed`);
});

console.log(`\n✓ Re-parsing complete. ${files.length} files updated.`);
console.log(`\nNow run generate-all-watches-excel.js to regenerate Excel.`);
