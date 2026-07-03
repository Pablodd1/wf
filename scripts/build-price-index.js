#!/usr/bin/env node
/**
 * Build Price Research index from catalog — SHORTENED refs only.
 * Removes full OEM serial codes (15202ST.OO.1240ST.01 → 15202ST)
 * so dropdown shows only what dealers actually type.
 */
const fs = require('fs');
const path = require('path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'catalog.json'), 'utf8'));

function shortenRef(ref, brand) {
  let s = ref.trim();
  // Audemars Piguet: 15202ST.OO.1240ST.01 → 15202ST
  if (brand === 'Audemars Piguet') s = s.replace(/\..+/, '');
  // Omega: 210.20.42.20.01.001 → 210.20.42
  else if (brand === 'Omega') s = s.replace(/^(\d+\.\d+\.\d+)\..+$/, '$1');
  // Tudor: M25827KN-0001 → 25827KN
  else if (brand === 'Tudor') s = s.replace(/^M/, '').replace(/-\w+$/, '');
  // Breitling: PB0134101C1S1 → PB0134101
  else if (brand === 'Breitling') s = s.replace(/[A-Z]\d[\w.]{2,6}$/, '');
  // Breguet: 3880ST/H2/3XV → 3880ST
  else if (brand === 'Breguet' || brand === 'Blancpain') s = s.replace(/[\/-].*/, '');
  // Rolex: 126579RBR → 126579RBR (keep — already short)
  // Patek: 5711/110P-001 → 5711/110P (keep with slash, drop dash suffix)
  else if (brand === 'Patek Philippe') s = s.replace(/-[\w]+$/, '');
  // TAG Heuer: CAW218B.FC6496 → CAW218B
  else if (brand === 'TAG Heuer') s = s.replace(/\..+/, '');
  // Cartier: HPI00327 → HPI00327 (keep)
  // All others: keep as-is
  
  return s;
}

const brandIndex = {};
const seen = new Set();

for (const e of catalog) {
  if (!e.brand || !e.reference) continue;
  const short = shortenRef(e.reference, e.brand);
  const key = e.brand + '|' + short;
  if (seen.has(key)) continue;
  seen.add(key);
  
  if (!brandIndex[e.brand]) brandIndex[e.brand] = new Set();
  brandIndex[e.brand].add(short);
}

// Convert to plain object and sort
const output = {};
for (const [b, refs] of Object.entries(brandIndex)) {
  output[b] = [...refs].sort();
}

fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(output));
const total = Object.values(output).reduce((a, r) => a + r.length, 0);
console.log('Brand index rebuilt: ' + Object.keys(output).length + ' brands, ' + total + ' refs');
console.log('Reduction from ' + catalog.length + ' to ' + total + ' refs (' + Math.round((catalog.length-total)/catalog.length*100) + '%)');

for (const [b, refs] of Object.entries(output).sort((a,b) => b[1].length - a[1].length)) {
  console.log('  ' + b + ': ' + refs.length + ' refs — e.g. ' + refs.slice(0, 3).join(', '));
}
