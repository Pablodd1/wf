#!/usr/bin/env node
/**
 * FIX-MISSING-FIELDS: Extracts dialColor, price, condition, year from rawMessage text.
 * Fixes TSV files in-place on Desktop, then regenerates Excel.
 * Much faster than full parser re-run (regex only, no catalog matching).
 */

const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';

const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_') && f.endsWith('_corrected.tsv'));
console.log(`Fixing missing fields in ${files.length} TSV files...\n`);

let totalFixed = 0;

files.forEach(file => {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  
  const rawMsgIdx = header.findIndex(h => h === 'rawMessage' || h === 'raw_message');
  const dialIdx = header.findIndex(h => h === 'dialColor' || h === 'dial_color');
  const priceIdx = header.findIndex(h => h === 'price' || h === 'price_usd');
  const condIdx = header.findIndex(h => h === 'condition');
  const yearIdx = header.findIndex(h => h === 'year');
  
  const updatedLines = [header.join('\t')];
  let fileFixed = 0;
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const rawMessage = cols[rawMsgIdx];
    if (!rawMessage) { updatedLines.push(lines[i]); continue; }
    
    // 1. Extract dialColor
    if (dialIdx !== -1 && (!cols[dialIdx] || cols[dialIdx] === 'null' || cols[dialIdx] === 'undefined')) {
      const dialMatch = rawMessage.match(/\b(black|white|silver|blue|green|red|gold|pink|grey|gray|brown|yellow|champagne|orange|purple|salmon|ivory|cream|chocolate|copper|pearl|anthracite|indigo|cyan|magenta|teal|navy|aqua|ruby|emerald|sapphire|titanium|platinum)\b/i);
      if (dialMatch) {
        const color = dialMatch[1].charAt(0).toUpperCase() + dialMatch[1].slice(1).toLowerCase();
        cols[dialIdx] = color;
        fileFixed++;
      }
    }
    
    // 2. Extract price (currency + number)
    if (priceIdx !== -1 && (!cols[priceIdx] || cols[priceIdx] === 'null')) {
      const priceMatch = rawMessage.match(/(?:price\s*\$|usd\s*\$|hkd\s*\$|cny\s*¥|[¥¥]\s*|^\s*\$|Price\s+\$)\s*[\d,]+/i);
      if (priceMatch) {
        const priceNum = priceMatch[0].replace(/[^\d]/g, '');
        if (priceNum && parseInt(priceNum) > 100) {
          cols[priceIdx] = priceNum;
          fileFixed++;
        }
      }
    }
    
    // 3. Extract condition
    if (condIdx !== -1 && (!cols[condIdx] || cols[condIdx] === 'null')) {
      const condMatch = rawMessage.match(/\b(New|Unused|Like New|Very Good|Excellent|Good|Fair|Poor|Used|Full Set|Box & Papers|Box Only|Papers Only|Naked|Complete Set|Mint)\b/i);
      if (condMatch) {
        cols[condIdx] = condMatch[1].charAt(0).toUpperCase() + condMatch[1].slice(1).toLowerCase();
        fileFixed++;
      }
    }
    
    // 4. Extract year
    if (yearIdx !== -1 && (!cols[yearIdx] || cols[yearIdx] === 'null')) {
      const yearMatch = rawMessage.match(/(?:Year|year|Yr|yr)\s*(\d{4})\b/);
      if (yearMatch && parseInt(yearMatch[1]) >= 1980 && parseInt(yearMatch[1]) <= 2026) {
        cols[yearIdx] = yearMatch[1];
        fileFixed++;
      }
    }
    
    updatedLines.push(cols.join('\t'));
  }
  
  fs.writeFileSync(filePath, updatedLines.join('\n') + '\n');
  totalFixed += fileFixed;
  if (fileFixed > 0) console.log(`  ✓ ${file}: ${fileFixed} fields fixed`);
});

console.log(`\n✓ Fixed ${totalFixed} missing fields across ${files.length} files.`);
console.log(`\nNow regenerating Excel...`);
