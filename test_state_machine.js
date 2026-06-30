#!/usr/bin/env node
/**
 * State Machine Test Harness — 10 Complex Cases
 * Run: node test_state_machine.js
 *
 * Tests OLD parser (v3.1) vs NEW state machine on the same inputs.
 * Outputs side-by-side comparison.
 */

const { parseFull } = require('./parser.js');

// Wrapper to match old API name
const parseWatch = parseFull;

// ─── 10 NIGHTMARE TEST CASES ─────────────────────────────────────────
const TEST_CASES = [
  {
    id: 1,
    name: 'Bundle with emoji separators',
    input: '🌟 PP 5711 blue unworn 2023 asking 95k\n🌟 PP 7118 white mint 2023 asking 82k\n🌟 Rolex 126500LN black new asking 28k',
    expected: { count: 3, refs: ['5711', '7118', '126500LN'] }
  },
  {
    id: 2,
    name: 'Chinese brand name',
    input: '百达翡丽 5711 蓝色 全新 95000',
    expected: { brand: 'Patek Philippe', ref: '5711', price: 95000 }
  },
  {
    id: 3,
    name: 'Missing brand, reference only',
    input: 'Selling 15510ST blue mint asking 42k',
    expected: { brand: 'Audemars Piguet', ref: '15510ST', price: 42000 }
  },
  {
    id: 4,
    name: 'Price = reference conflict (NORM_003)',
    input: 'Rolex 126301 unworn 2023 asking 126,301',
    expected: { ref: '126301', price: null, flags: 'PRICE_OUTLIER' }
  },
  {
    id: 5,
    name: 'Abbreviated brand (FPJ CS)',
    input: 'FPJ CS blue unworn 85k',
    expected: { brand: 'F.P. Journe', ref: 'CS', price: 85000 }
  },
  {
    id: 6,
    name: 'Period-separated fields',
    input: 'Patek 5711. Chocolate. Unworn. 95K+',
    expected: { brand: 'Patek Philippe', ref: '5711', dial: 'Chocolate', price: 95000 }
  },
  {
    id: 7,
    name: 'HKD shorthand (NORM_002)',
    input: 'RM11-03 titanium hkd998m full set',
    expected: { brand: 'Richard Mille', ref: 'RM11-03', price: 127700 }
  },
  {
    id: 8,
    name: 'Non-watch item (bag)',
    input: 'Gucci horsebit 1955 shoulder bag leather brown $1825',
    expected: { type: 'OTHER', confidence: '<30%', verdict: 'RECYCLE' }
  },
  {
    id: 9,
    name: 'Multiple prices + multiple refs',
    input: 'PP 5711 blue $95k and 7118 white $82k — take both for 170k',
    expected: { count: 2, prices: [95000, 82000] }
  },
  {
    id: 10,
    name: 'Mixed languages + nicknames',
    input: 'Rolex GMT 126710BLRO Pepsi unworn box papers €14.5k',
    expected: { brand: 'Rolex', ref: '126710BLRO', nickname: 'Pepsi', price: 14500, currency: 'EUR' }
  }
];

// ─── MINI STATE MACHINE (what we're testing) ──────────────────────────

// Stage 0: Classifier
function classify(text) {
  const hasEmoji = /[🌟⭐🔥💎🕐🕑🕒]/.test(text);
  const hasNewlines = (text.match(/\n/g) || []).length > 0;
  const hasSeparators = /\/\/|🌟|⭐|🔥/.test(text);
  const isBundle = hasNewlines && (hasSeparators || (text.match(/\b(x\d|for \d|both|bundle|lot of)\b/gi) || []).length > 0);
  const hasImageRef = /\.(jpg|jpeg|png|webp|heic)/i.test(text) || text.length < 15;

  return {
    type: isBundle ? 'BUNDLE' : 'SINGLE',
    format: hasEmoji ? 'WHATSAPP_EMOJI' : 'WHATSAPP_TEXT',
    language: /[\u4e00-\u9fff]/.test(text) ? 'ZH' : 'EN',
    hasAbbreviations: /\b(FPJ|AP|VC|JLC|GS|GF|MBF|DB)\b/.test(text),
    estimatedWatchCount: isBundle ? Math.max(2, (text.match(/(\d{4,6}\s?[A-Z]{0,4}|RM\d{2})/g) || []).length) : 1,
    confidence: isBundle ? 0.95 : 0.90
  };
}

// Stage 1: Splitter
function splitBundle(text, classification) {
  if (classification.type !== 'BUNDLE') return [text];

  const separators = [
    /\n(?=[🌟⭐🔥💎])/g,          // Emoji at line start
    /\n(?=[A-Z][a-z]+\s*\d{4,6})/g,  // Brand + ref at line start
    /\s*\/\/\s*/g,               // "//"
    /\s*\|\s*/g,                 // "|"
    /\n{2,}/g,                    // Double newlines
  ];

  let parts = [text];
  for (const sep of separators) {
    parts = parts.flatMap(p => p.split(sep)).map(p => p.trim());
  }

  return parts.filter(p => p.length > 5 && /\d/.test(p));
}

// Stage 2: Extractor (multi-strategy)
function extractWithStrategy(text, strategy) {
  switch (strategy) {
    case 'REGEX':
      return extractWithRegex(text);
    case 'CATALOG_LOOKUP':
      return extractWithCatalog(text);
    default:
      return null;
  }
}

// Strategy A: Regex (our current v3.1)
function extractWithRegex(text) {
  try {
    return parseWatch(text);
  } catch (e) {
    return null;
  }
}

// Strategy B: Catalog lookup (new — simplified for test)
function extractWithCatalog(text) {
  // Try regex first
  const regexResult = extractWithRegex(text);
  if (!regexResult) return null;

  // Then validate against mini catalog
  const ref = regexResult.ref || regexResult.reference;
  const catalogEntry = MINI_CATALOG.find(c =>
    ref && String(ref).includes(c.reference)
  );

  if (catalogEntry) {
    return {
      ...regexResult,
      brand: regexResult.brand || catalogEntry.brand,
      model: regexResult.model || catalogEntry.model,
      dial: regexResult.dial || catalogEntry.dial,
      catalogMatched: true,
      confidence: 0.95
    };
  }

  return { ...regexResult, catalogMatched: false };
}

// Stage 3: Validator
function validate(extracted, catalogEntry) {
  const flags = [];
  const ref = extracted?.ref || extracted?.reference;

  if (!extracted || !ref) flags.push('REF_NOT_FOUND');
  if (!extracted || !extracted.brand) flags.push('BRAND_NOT_FOUND');
  if (!catalogEntry) flags.push('CATALOG_MISMATCH');

  if (catalogEntry && extracted) {
    const dialLower = (extracted.dial || '').toLowerCase();
    const validDials = catalogEntry.dial_colors.map(d => d.toLowerCase());
    if (dialLower && !validDials.includes(dialLower)) {
      flags.push('DIAL_MISMATCH');
    }
  }

  // NORM_003: Price = reference conflict
  if (extracted && extracted.price && ref) {
    const price = Number(extracted.price);
    const refNum = Number(String(ref).replace(/\D/g, ''));
    if (refNum > 0 && Math.abs(price - refNum) / refNum < 0.01) {
      flags.push('PRICE_IS_REFERENCE');
    }
  }

  // NORM_004: Non-watch detection
  const nonWatchKeywords = ['bag', 'shoulder bag', 'leather goods', 'strap', 'wallet', 'belt'];
  if (extracted && nonWatchKeywords.some(k => (extracted.raw || '').toLowerCase().includes(k))) {
    flags.push('NON_WATCH_ITEM');
  }

  return {
    flags,
    isValid: flags.length === 0,
    exceptionFlags: flags.reduce((acc, f) => acc | (FLAG_VALUES[f] || 0), 0)
  };
}

// Stage 4: Router
function route(validation, extracted) {
  if (validation.isValid) {
    return { state: 'APPROVED', reason: 'All checks passed', cost: 0 };
  }

  if (validation.flags.includes('PRICE_IS_REFERENCE') || validation.flags.includes('NON_WATCH_ITEM')) {
    return { state: 'RECYCLE', reason: validation.flags.join(', '), cost: 0 };
  }

  if (validation.flags.includes('CATALOG_MISMATCH') || validation.flags.includes('REF_NOT_FOUND')) {
    return { state: 'REVIEW', reason: validation.flags.join(', '), cost: 0, needsHuman: true };
  }

  return { state: 'REVIEW', reason: validation.flags.join(', '), cost: 0 };
}

// ─── MINI MASTER CATALOG (for testing) ────────────────────────────────
const MINI_CATALOG = [
  { brand: 'Patek Philippe', model: 'Nautilus', reference: '5711', dial_colors: ['Blue', 'Black', 'White'] },
  { brand: 'Patek Philippe', model: 'Nautilus Ladies', reference: '7118', dial_colors: ['White', 'Blue', 'Champagne'] },
  { brand: 'Rolex', model: 'Daytona', reference: '126500', dial_colors: ['Black', 'White'] },
  { brand: 'Rolex', model: 'GMT-Master II', reference: '126710', dial_colors: ['Black', 'Blue', 'Pepsi'], nickname: 'Pepsi' },
  { brand: 'Audemars Piguet', model: 'Royal Oak', reference: '15510', dial_colors: ['Blue', 'Black', 'White', 'Green'] },
  { brand: 'Richard Mille', model: 'RM 11-03', reference: 'RM11-03', dial_colors: ['Black', 'Grey'] },
  { brand: 'F.P. Journe', model: 'Chronometre Souverain', reference: 'CS', dial_colors: ['Blue', 'Silver', 'White'] },
  { brand: 'Rolex', model: 'Datejust', reference: '126301', dial_colors: ['Champagne', 'Silver', 'Blue'] },
];

const FLAG_VALUES = {
  REF_NOT_FOUND: 1,
  REF_MULTIPLE: 2,
  COLOR_NOT_FOUND: 4,
  COLOR_MULTIPLE: 8,
  PRICE_NOT_FOUND: 16,
  PRICE_MULTIPLE: 32,
  CATALOG_MISMATCH: 128,
  CATALOG_PARTIAL_MATCH: 256,
  DIAL_MISMATCH: 512,
  PRICE_IS_REFERENCE: 1024,
  NON_WATCH_ITEM: 2048,
  BRAND_NOT_FOUND: 4096
};

// ─── RUN TESTS ────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  STATE MACHINE TEST — 10 Complex Cases');
console.log('  Old Parser v3.1  vs  New State Machine (Catalog + Validation)');
console.log('═══════════════════════════════════════════════════════════════\n');

let oldCorrect = 0;
let newCorrect = 0;

for (const test of TEST_CASES) {
  console.log(`─`.repeat(65));
  console.log(`Test #${test.id}: ${test.name}`);
  console.log(`Input: "${test.input.substring(0, 80)}${test.input.length > 80 ? '...' : ''}"`);
  console.log(`Expected: ${JSON.stringify(test.expected)}`);
  console.log();

  // OLD parser
  let oldResult;
  try {
    oldResult = parseWatch(test.input);
    if (oldResult && (oldResult.verdict === 'APPROVED' || oldResult.verdict === 'REVIEW')) oldCorrect++;
  } catch (e) {
    oldResult = { error: e.message };
  }

  console.log('  [OLD PARSER v3.1]');
  console.log(`    Brand: ${oldResult?.brand || 'null'}`);
  console.log(`    Ref:   ${oldResult?.ref || oldResult?.reference || 'null'}`);
  console.log(`    Price: ${oldResult?.price || 'null'}`);
  console.log(`    Dial:  ${oldResult?.dial || 'null'}`);
  console.log(`    Verdict: ${oldResult?.verdict || 'ERROR'}`);
  console.log(`    Confidence: ${oldResult?.confidence || 'N/A'}`);
  console.log();

  // NEW state machine
  const classification = classify(test.input);
  const parts = splitBundle(test.input, classification);

  console.log(`  [NEW STATE MACHINE]`);
  console.log(`    Classified as: ${classification.type} (${parts.length} parts)`);
  console.log(`    Language: ${classification.language}`);
  console.log(`    Has abbreviations: ${classification.hasAbbreviations}`);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    console.log(`\n    --- Part ${i + 1}: "${part.substring(0, 60)}${part.length > 60 ? '...' : ''}" ---`);

    // Try regex first
    let extracted = extractWithStrategy(part, 'REGEX');
    const strategy = extracted ? 'REGEX' : 'CATALOG_LOOKUP';

    if (!extracted) {
      extracted = extractWithStrategy(part, 'CATALOG_LOOKUP');
    }

    // If still no extraction, try to infer brand from reference
    if (!extracted || !extracted.brand) {
      const inferredBrand = inferBrandFromRefForTest(extracted?.ref || extracted?.reference);
      if (inferredBrand) {
        extracted = extracted || {};
        extracted.brand = inferredBrand;
        extracted.inferred = true;
      }
    }

    // Validate against catalog
    const ref = extracted?.ref || extracted?.reference;
    const catalogEntry = MINI_CATALOG.find(c =>
      ref && String(ref).includes(c.reference)
    );
    const validation = validate(extracted, catalogEntry);
    const routing = route(validation, extracted);

    if (routing.state === 'APPROVED') newCorrect++;

    console.log(`      Strategy: ${strategy}${extracted?.inferred ? ' + INFERRED_BRAND' : ''}`);
    console.log(`      Brand: ${extracted?.brand || 'null'} ${catalogEntry ? `(catalog: ${catalogEntry.brand})` : ''}`);
    console.log(`      Ref:   ${extracted?.ref || extracted?.reference || 'null'}`);
    console.log(`      Price: ${extracted?.price || 'null'}`);
    console.log(`      Dial:  ${extracted?.dial || 'null'}`);
    console.log(`      Catalog Match: ${catalogEntry ? 'YES' : 'NO'}`);
    console.log(`      Exception Flags: [${validation.flags.join(', ') || 'NONE'}]`);
    console.log(`      → STATE: ${routing.state} (${routing.reason})`);
  }
  console.log();
}

// Helper
function inferBrandFromRefForTest(ref) {
  if (!ref) return null;
  const patterns = [
    { test: /^571[0-9]|^7118|^57[0-9]{2}/, brand: 'Patek Philippe' },
    { test: /^126|^116|^228|^124/, brand: 'Rolex' },
    { test: /^155|^152|^264|^262/, brand: 'Audemars Piguet' },
    { test: /^RM/, brand: 'Richard Mille' },
    { test: /^CS/, brand: 'F.P. Journe' },
  ];
  return patterns.find(p => p.test.test(ref))?.brand || null;
}

console.log('═'.repeat(65));
console.log('SUMMARY');
console.log('═'.repeat(65));
console.log(`Old Parser v3.1:   ${oldCorrect}/10 passed`);
console.log(`New State Machine: ${newCorrect}/10 passed`);
console.log(`Improvement:       ${newCorrect > oldCorrect ? '+' : ''}${newCorrect - oldCorrect} cases`);
console.log();
console.log('Note: "Passed" = APPROVED verdict (all validation checks passed).');
console.log('Cases routed to REVIEW are flagged for human review with specific');
console.log('exception flags showing exactly what needs correction.');
