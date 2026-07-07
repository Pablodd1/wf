#!/usr/bin/env node
/**
 * FINAL-FIX: Aggressive extraction of price + year from rawMessage.
 * Catches formats like "$12,500", "HKD 12,500", "Price 12,500", "12,500 USD", etc.
 */

const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';

const files = fs.readdirSync(DESKTOP)
  .filter(f => f.endsWith('_corrected.tsv'));
console.log(`Final fix pass on ${files.length} files...\n`);

let totalFixed = 0;

files.forEach(file => {
  const filePath = path.join(DESKTOP, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  
  const rawMsgIdx = header.findIndex(h => h === 'rawMessage' || h === 'raw_message');
  const priceIdx = header.findIndex(h => h === 'price' || h === 'price_usd');
  const yearIdx = header.findIndex(h => h === 'year');
  
  const updatedLines = [header.join('\t')];
  let fileFixed = 0;
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const rawMessage = cols[rawMsgIdx] || '';
    
    // AGGRESSIVE PRICE: Catch any dollar amount
    if (priceIdx !== -1 && (!cols[priceIdx] || cols[priceIdx] === 'null' || cols[priceIdx] === 'None')) {
      // Patterns: "$12,500", "HKD 12,500", "Price: $12,500", "12,500 USD", "12.500 USD", etc.
      const patterns = [
        /[$¥£€]+\s*([\d,]+\.?\d*)/,
        /(\d+[\d,]*\.?\d*)\s*(?:USD|HKD|CNY|EUR|GBP|CHF)/i,
        /(?:price|Price|PREZZO)[:\s]*[$¥£€]?\s*([\d,]+\.?\d*)/i,
        /[$¥£€]+\s*(\d+[\d,]*\.?\d*)/,
      ];
      
      for (const pattern of patterns) {
        const match = rawMessage.match(pattern);
        if (match) {
          const priceNum = match[1].replace(/[^\d]/g, '');
          if (priceNum && parseInt(priceNum) > 100 && parseInt(priceNum) < 9999999) {
            cols[priceIdx] = priceNum;
            fileFixed++;
            break;
          }
        }
      }
    }
    
    // AGGRESSIVE YEAR: Catch any 4-digit year
    if (yearIdx !== -1 && (!cols[yearIdx] || cols[yearIdx] === 'null' || cols[yearIdx] === 'None')) {
      const yearMatch = rawMessage.match(/\b((?:19|20)\d{2})\b/);
      if (yearMatch && parseInt(yearMatch[1]) >= 1980 && parseInt(yearMatch[1]) <= 2026) {
        cols[yearIdx] = yearMatch[1];
        fileFixed++;
      }
    }
    
    updatedLines.push(cols.join('\t'));
  }
  
  if (fileFixed > 0) {
    fs.writeFileSync(filePath, updatedLines.join('\n') + '\n');
    totalFixed += fileFixed;
    console.log(`  ✓ ${file}: ${fileFixed} fields fixed`);
  }
});

console.log(`\n✓ Final fix: ${totalFixed} additional fields fixed.`);
