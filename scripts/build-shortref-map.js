#!/usr/bin/env node
/**
 * build-shortref-map.js — JASS-6 Phase 0 short→full reference map.
 *
 * RULE (no guessing): a bare short reference is folded to its full catalog
 * form ONLY when the expansion is UNAMBIGUOUS — i.e. exactly one distinct
 * full reference in that brand shares the short's numeric base AND the short
 * is a genuine prefix of it. When a base maps to multiple full refs (e.g. AP
 * 15210 → 28 variants), we DO NOT fold — the dealer's short ref is kept and
 * the record stays as-is (no fabrication).
 *
 * Dial-color / material variants of the SAME model are treated as one fold
 * target only when they collapse to a single reference string; if the
 * reference strings themselves differ, it's ambiguous and skipped.
 *
 * Output: api/_lib/shortref-map.json  { "BRAND|SHORT": "FULLREF", ... }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CATALOG = path.join(__dirname, '..', 'public', 'catalog.json');
const OUT = path.join(__dirname, '..', 'api', '_lib', 'shortref-map.json');

const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));

// Group distinct full references by (brand, numeric-base).
const norm = (r) => (r || '').toUpperCase().replace(/[\s]/g, '');
const byBase = new Map(); // key "BRAND|BASE" -> Set(fullRef)
const allFullRefs = new Map(); // "BRAND|FULLREF" -> true (to skip mapping a ref onto itself)

for (const x of data) {
  const brand = (x.brand || '').toUpperCase().trim();
  const ref = norm(x.reference);
  if (!brand || !ref) continue;
  allFullRefs.set(`${brand}|${ref}`, true);
  const m = ref.match(/^(\d{4,6})/);
  if (!m) continue;
  const base = m[1];
  const key = `${brand}|${base}`;
  if (!byBase.has(key)) byBase.set(key, new Set());
  byBase.get(key).add(ref);
}

const map = {};
let unambiguous = 0, ambiguous = 0, exactOnly = 0;
const ambiguousSamples = [];

for (const [key, fulls] of byBase) {
  const [brand, base] = key.split('|');
  const arr = [...fulls];

  // If the bare base IS itself a catalog ref (e.g. Rolex 126334), no fold needed.
  if (fulls.has(base)) { exactOnly++; continue; }

  // Candidates the short base is a genuine prefix of.
  const foldTargets = arr.filter((f) => f.startsWith(base) && f !== base);
  const distinct = [...new Set(foldTargets)];

  if (distinct.length === 1) {
    // UNAMBIGUOUS: exactly one full ref extends this base.
    map[`${brand}|${base}`] = distinct[0];
    unambiguous++;
  } else if (distinct.length > 1) {
    ambiguous++;
    if (ambiguousSamples.length < 8) ambiguousSamples.push(`${brand} ${base} -> ${distinct.length} variants`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(map, null, 0));

console.log('=== short→full map build ===');
console.log('catalog entries        :', data.length);
console.log('numeric-base groups    :', byBase.size);
console.log('bare-ref exact (skip)  :', exactOnly);
console.log('UNAMBIGUOUS (mapped)   :', unambiguous);
console.log('ambiguous (NOT mapped) :', ambiguous);
console.log('map written to         :', OUT, `(${Object.keys(map).length} entries)`);
console.log('');
console.log('sanity checks:');
console.log('  Rolex|116500 ->', map['ROLEX|116500'] || '(not mapped)');
console.log('  AP|15210     ->', map['AUDEMARS PIGUET|15210'] || '(not mapped — ambiguous, correct)');
console.log('  AP|15500     ->', map['AUDEMARS PIGUET|15500'] || '(not mapped — ambiguous, correct)');
console.log('');
console.log('ambiguous samples (correctly skipped):');
ambiguousSamples.forEach((s) => console.log('  -', s));
