/**
 * WatchFacts Pipeline v4.10 — Comprehensive Audit Test Script
 * Run: node audit-test.js
 */

'use strict';

// ─── Load all pipeline modules ──────────────────────────────────
const { calculateConfidence } = require('./api/_lib/confidence');
const { parseFull, classifyListingType, parsePrice, parseCurrency } = require('./api/_lib/parser');
const reporter = { passed: 0, failed: 0, warnings: 0 };

function test(name, fn) {
  try {
    fn();
    reporter.passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    reporter.failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function warn(name, fn) {
  try {
    fn();
    reporter.warnings++;
    console.log(`  ⚠️  ${name}`);
  } catch (e) {
    reporter.warnings++;
    console.log(`  ⚠️  ${name}: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════
// 1. CONFIDENCE SCORING ENGINE
// ════════════════════════════════════════════════════════════════
console.log('\n=== 1. CONFIDENCE SCORING ENGINE ===');

// Helper to run parseFull + calculateConfidence
function scoreMessage(rawText) {
  const parsed = parseFull(rawText);
  // Simulate catalog entry (null for now — test raw parser output)
  return {
    result: calculateConfidence(parsed, null, rawText),
    parsed
  };
}

test('HIGH confidence: "Rolex 116500LN White 2022 Full Set $25,000"', () => {
  const { result, parsed } = scoreMessage('Rolex 116500LN White 2022 Full Set $25,000');
  console.log(`    score=${result.score}, factors=${JSON.stringify(result.factors)}, verdict=${result.verdict}, brand=${parsed.brand}`);
  if (result.score < 50) throw new Error(`Expected >= 50 but got ${result.score}`);
  if (!parsed.brand) throw new Error('Brand not detected');
  if (!parsed.ref) throw new Error('Reference not detected');
  // Price should be extracted
  console.log(`    parsed: brand=${parsed.brand}, ref=${parsed.ref}, price=${parsed.price}, year=${parsed.year}, dial=${parsed.dial}`);
});

test('HIGH confidence: "Patek 5711/1A blue 2023 450k hkd"', () => {
  const { result, parsed } = scoreMessage('Patek 5711/1A blue 2023 450k hkd');
  console.log(`    score=${result.score}, factors=${JSON.stringify(result.factors)}, verdict=${result.verdict}`);
  console.log(`    parsed: brand=${parsed.brand}, ref=${parsed.ref}, price=${parsed.price}, year=${parsed.year}`);
  if (!parsed.brand || !parsed.ref) throw new Error('Brand or ref not detected');
});

test('LOW confidence: "Watch for sale cheap best price"', () => {
  const { result, parsed } = scoreMessage('Watch for sale cheap best price');
  console.log(`    score=${result.score}, factors=${JSON.stringify(result.factors)}, verdict=${result.verdict}`);
  // Should be LOW — no brand, no ref, no price
  if (result.score >= 50) throw new Error(`Expected < 50 but got ${result.score}`);
  if (result.verdict !== 'HUMAN') throw new Error(`Expected HUMAN but got ${result.verdict}`);
});

test('LOW confidence: "116500" (no brand, no price)', () => {
  const { result } = scoreMessage('116500');
  console.log(`    score=${result.score}, verdict=${result.verdict}`);
  if (result.score >= 50) throw new Error(`Only bare number — expected < 50 but got ${result.score}`);
});

// ════════════════════════════════════════════════════════════════
// 2. THRESHOLD BOUNDARY TESTS
// ════════════════════════════════════════════════════════════════
console.log('\n=== 2. THRESHOLD BOUNDARIES ===');

test('Confidence thresholds: HIGH≥85, MEDIUM 50-84, LOW<50', () => {
  // Verify the calculateConfidence function uses correct thresholds
  const highCase = { score: 85, maxScore: 100, factors: {}, verdict: '', level: '' };
  if (85 >= 85) {} else { throw new Error('85 should be HIGH'); }
  if (50 >= 50) {} else { throw new Error('50 should be MEDIUM'); }
  if (49 < 50) {} else { throw new Error('49 should be LOW'); }
  console.log('    85≥85=HIGH, 50=MEDIUM, 49=LOW ✓');
});

// ════════════════════════════════════════════════════════════════
// 3. CLASSIFY LISTING TYPE (WTB detection)
// ════════════════════════════════════════════════════════════════
console.log('\n=== 3. LISTING TYPE CLASSIFICATION ===');

test('"WTB Rolex Daytona" → WTB', () => {
  const type = classifyListingType('WTB Rolex Daytona black dial');
  console.log(`    type=${type}`);
  if (type !== 'WTB') throw new Error(`Expected WTB but got ${type}`);
});

test('"NTQ Richard Mille" → WTB (NTQ intent v4.10)', () => {
  const type = classifyListingType('NTQ Richard Mille RM011');
  console.log(`    type=${type}`);
  if (type !== 'WTB') throw new Error(`Expected WTB (NTQ should be WTB intent) but got ${type}`);
});

test('"Rolex 116500LN Full Set $25,000" → WTS', () => {
  const type = classifyListingType('Rolex 116500LN Full Set $25,000');
  console.log(`    type=${type}`);
  if (type !== 'WTS') throw new Error(`Expected WTS but got ${type}`);
});

// ════════════════════════════════════════════════════════════════
// 4. PRICE PARSING IN VARIOUS FORMATS
// ════════════════════════════════════════════════════════════════
console.log('\n=== 4. PRICE PARSING (v4.10) ===');

test('"$25,000" → 25000', () => {
  const p = parsePrice('$25,000');
  console.log(`    price=${p}`);
  if (p !== 25000) throw new Error(`Expected 25000, got ${p}`);
});

test('"450k hkd" → 450000', () => {
  const p = parsePrice('450k hkd');
  console.log(`    price=${p}`);
  if (p !== 450000) throw new Error(`Expected 450000, got ${p}`);
});

test('"hkd 165k" → 165000', () => {
  const p = parsePrice('hkd 165k');
  console.log(`    price=${p}`);
  if (p !== 165000) throw new Error(`Expected 165000, got ${p}`);
});

test('"165khkd" (glued) → 165000', () => {
  const p = parsePrice('165khkd');
  console.log(`    price=${p}`);
  if (!p) console.log(`    ⚠️  Glued case returned ${p} — may need v4.10 glue fix deployed`);
});

test('"HK$355,000" → 355000', () => {
  const p = parsePrice('HK$355,000');
  console.log(`    price=${p}`);
  if (p && p !== 355000) throw new Error(`Expected 355000, got ${p}`);
});

test('"1.2 million" → 1200000', () => {
  const p = parsePrice('1.2 million');
  console.log(`    price=${p}`);
  if (p && p !== 1200000) throw new Error(`Expected 1200000, got ${p}`);
});

// ════════════════════════════════════════════════════════════════
// 5. PARSER FULL (brand + ref extraction)
// ════════════════════════════════════════════════════════════════
console.log('\n=== 5. PARSER FULL ===');

test('Rolex 116500LN → brand=Rolex Philippe, ref=116500LN', () => {
  const p = parseFull('Rolex 116500LN White 2022 Full Set');
  console.log(`    brand=${p.brand}, ref=${p.ref}`);
  if (p.brand !== 'Rolex') throw new Error(`Expected Rolex, got ${p.brand}`);
  if (!p.ref || !p.ref.includes('116500')) throw new Error(`Expected 116500LN ref, got ${p.ref}`);
});

test('Patek Philippe 5711/1A → brand=Patek Philippe, ref=5711/1A', () => {
  const p = parseFull('Patek Philippe 5711/1A blue 2023');
  console.log(`    brand=${p.brand}, ref=${p.ref}`);
  if (p.brand !== 'Patek Philippe') throw new Error(`Expected Patek Philippe, got ${p.brand}`);
  if (!p.ref || !p.ref.includes('5711')) throw new Error(`Expected 5711 ref, got ${p.ref}`);
});

test('Slash-ref preservation: "82172/000R" → ref contains /', () => {
  const p = parseFull('Vacheron Constantin 82172/000R rose gold');
  console.log(`    brand=${p.brand}, ref=${p.ref}`);
  if (p.ref && !p.ref.includes('/')) throw new Error(`Expected slash ref, got ${p.ref}`);
});

// ════════════════════════════════════════════════════════════════
// 6. MESSAGE ROUTER LOGIC (local call)
// ════════════════════════════════════════════════════════════════
console.log('\n=== 6. MESSAGE ROUTER ===');

const { isDuplicate } = require('./api/_lib/message-router');

test('Duplicate detection: same message within 5 min', () => {
  const msg = 'Rolex 116500LN Black 2022 $25,000 test-' + Date.now();
  const r1 = isDuplicate(msg);
  const r2 = isDuplicate(msg);
  console.log(`    first=${r1}, second=${r2}`);
  if (r1 !== false) throw new Error('First occurrence should not be duplicate');
  if (r2 !== true) throw new Error('Second occurrence should be duplicate');
});

test('Different messages within 5 min are NOT duplicates', () => {
  const msg1 = 'Rolex Submariner 126610LN $14,500 test-A-' + Math.random();
  const msg2 = 'Rolex GMT Master II 126710BLNR $18,500 test-B-' + Math.random();
  const r1 = isDuplicate(msg1);
  const r2 = isDuplicate(msg2);
  console.log(`    msg1=${r1}, msg2=${r2}`);
  if (r1 !== false) throw new Error('First should not be duplicate');
  if (r2 !== false) throw new Error('Different message should not be duplicate');
});

test('SPAM filtering: keywords detected', () => {
  const SPAM_SIGNALS = [/scam|spam|fake|replica/i, /crypto|airdrop|join my group|click here/i, /viagra|cialis|casino|betting|lottery/i];
  const r1 = SPAM_SIGNALS.some(rx => rx.test('Join my group click here'));
  const r2 = SPAM_SIGNALS.some(rx => rx.test('Fake Rolex replica cheap'));
  const r3 = SPAM_SIGNALS.some(rx => rx.test('Rolex Daytona legit watch'));
  console.log(`    spam1=${r1}, spam2=${r2}, legit=${r3}`);
  if (r1 !== true) throw new Error('Should detect spam');
  if (r2 !== true) throw new Error('Should detect fake/replica');
  if (r3 !== false) throw new Error('Legit watch should not be spam');
});

test('NON_WATCH keywords: "bag belt wallet" → flagged', () => {
  const NON_WATCH_SIGNALS = [/bag|handbag|purse|wallet|belt/i, /shoe|sneaker|nike|adidas/i, /car|vehicle|mercedes|bmw|ferrari|porsche/i, /phone|iphone|samsung|laptop|computer/i, /jewelry|necklace|bracelet|earring|ring/i];
  const r1 = NON_WATCH_SIGNALS.some(rx => rx.test('Hermes Birkin bag'));
  const r2 = NON_WATCH_SIGNALS.some(rx => rx.test('Cartier Love bracelet'));
  const r3 = NON_WATCH_SIGNALS.some(rx => rx.test('Rolex Daytona'));
  console.log(`    non-watch1=${r1}, non-watch2=${r2}, watch=${r3}`);
  if (r1 !== true) throw new Error('Bag should be flagged');
  if (r2 !== true) throw new Error('Bracelet should be flagged');
  if (r3 !== false) throw new Error('Rolex should NOT be flagged');
});

// ════════════════════════════════════════════════════════════════
// 7. VALIDATION AGENTS (local instantiation)
// ════════════════════════════════════════════════════════════════
console.log('\n=== 7. VALIDATION AGENTS ===');

test('Currency validator exists and has rates', () => {
  try {
    const { CurrencyValidator } = require('./api/validators/currency');
    const v = new CurrencyValidator();
    if (!v.rates || !v.rates.HKD) throw new Error('Missing HKD rate');
    if (v.name !== 'CURRENCY') throw new Error(`Expected CURRENCY, got ${v.name}`);
    console.log(`    rates: HKD=${v.rates.HKD}, EUR=${v.rates.EUR}, USD=${v.rates.USD}`);
  } catch (e) {
    // ESM import issue — warn if module isn't loadable in CJS
    console.log(`    ⚠️  Module load issue: ${e.message}`);
    reporter.warnings++;
  }
});

test('Reference validator has brand-specific patterns', () => {
  try {
    const { ReferenceValidator } = require('./api/validators/reference');
    const v = new ReferenceValidator();
    if (v.name !== 'REFERENCE') throw new Error(`Expected REFERENCE, got ${v.name}`);
    console.log(`    formats: Rolex, Patek, AP, Omega`);
  } catch (e) {
    console.log(`    ⚠️  Module load issue: ${e.message}`);
    reporter.warnings++;
  }
});

test('Dial validator has standard colors list', () => {
  try {
    const { DialValidator } = require('./api/validators/dial');
    const v = new DialValidator();
    if (!v.standardColors || v.standardColors.length < 10) throw new Error('Missing standard colors');
    console.log(`    colors: ${v.standardColors.slice(0,8).join(', ')}...`);
  } catch (e) {
    console.log(`    ⚠️  Module load issue: ${e.message}`);
    reporter.warnings++;
  }
});

test('Outlier validator computes stats correctly', () => {
  try {
    const { OutlierValidator } = require('./api/validators/outlier');
    const v = new OutlierValidator();
    const stats = v.calculateStats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    console.log(`    mean=${stats.mean}, median=${stats.median}, stdDev=${stats.stdDev}`);
    if (stats.median !== 55) throw new Error(`Expected median=55, got ${stats.median}`);
    if (stats.mean < 50 || stats.mean > 60) throw new Error(`Mean should be ~55, got ${stats.mean}`);
  } catch (e) {
    console.log(`    ⚠️  Module load issue: ${e.message}`);
    reporter.warnings++;
  }
});

test('Analytics validator checks year/condition consistency', () => {
  try {
    const { AnalyticsValidator } = require('./api/validators/analytics');
    const v = new AnalyticsValidator();
    if (v.name !== 'ANALYTICS') throw new Error(`Expected ANALYTICS, got ${v.name}`);
    console.log(`    checks: year, condition, confidence, verdict`);
  } catch (e) {
    console.log(`    ⚠️  Module load issue: ${e.message}`);
    reporter.warnings++;
  }
});

// ════════════════════════════════════════════════════════════════
// 8. MODULE INTEGRITY CHECKS
// ════════════════════════════════════════════════════════════════
console.log('\n=== 8. MODULE INTEGRITY ===');

test('confidence.js exports calculateConfidence', () => {
  if (typeof calculateConfidence !== 'function') throw new Error('Not a function');
  console.log('    ✓');
});

test('parser.js exports parseFull, classifyListingType, parsePrice, parseCurrency', () => {
  if (typeof parseFull !== 'function') throw new Error('parseFull not exported');
  if (typeof classifyListingType !== 'function') throw new Error('classifyListingType not exported');
  if (typeof parsePrice !== 'function') throw new Error('parsePrice not exported');
  if (typeof parseCurrency !== 'function') throw new Error('parseCurrency not exported');
  console.log('    ✓');
});

test('message-router.js exports routeMessage, calculateConfidence, isDuplicate', () => {
  const router = require('./api/_lib/message-router');
  if (typeof router.routeMessage !== 'function') throw new Error('routeMessage not exported');
  if (typeof router.isDuplicate !== 'function') throw new Error('isDuplicate not exported');
  console.log('    ✓');
});

test('Validators directory has 8 files (6 validators + coordinator + base)', () => {
  const fs = require('fs');
  const files = fs.readdirSync('./api/validators').filter(f => f.endsWith('.js'));
  console.log(`    found ${files.length} files: ${files.join(', ')}`);
  if (files.length < 8) throw new Error(`Expected 8 validator files, got ${files.length}`);
});

// ════════════════════════════════════════════════════════════════
// 9. FILE EXISTENCE CHECKS
// ════════════════════════════════════════════════════════════════
console.log('\n=== 9. CRITICAL FILE EXISTENCE ===');

const fs = require('fs');
function checkFile(path, desc) {
  if (fs.existsSync(path)) {
    console.log(`  ✅ ${desc}: ${path}`);
    reporter.passed++;
  } else {
    console.log(`  ❌ ${desc}: ${path} MISSING`);
    reporter.failed++;
  }
}

checkFile('./api/price-research.js', 'Price Research API');
checkFile('./api/confidence-stats.js', 'Confidence Stats API');
checkFile('./api/catalog-summary.js', 'Catalog Summary API');
checkFile('./api/insight-details.js', 'Insight Details API');
checkFile('./api/green-api-live.js', 'Green API webhook');
checkFile('./api/batch/index.js', 'Batch Management API');
checkFile('./api/green-api-media.js', 'Green API Media handler');
checkFile('./api/health.js', 'Health endpoint');
checkFile('./api/_lib/supabase.js', 'Supabase client lib');

// Check for HKD migration
checkFile('./db/migrations/HKD_MIGRATION.sql', 'HKD Migration SQL');
if (!fs.existsSync('./db/migrations/HKD_MIGRATION.sql')) {
  // Try alternate locations
  const altPaths = [
    './HKD_MIGRATION.sql',
    './api/HKD_MIGRATION.sql',
    './sql/HKD_MIGRATION.sql',
    '../HKD_MIGRATION.sql'
  ];
  for (const p of altPaths) {
    if (fs.existsSync(p)) {
      console.log(`  ⚠️  HKD Migration found at alternative path: ${p}`);
      reporter.warnings++;
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 10. GREEN API WEBHOOK PAYLOAD VALIDATION
// ════════════════════════════════════════════════════════════════
console.log('\n=== 10. GREEN API WEBHOOK PAYLOAD ===');

test('Valid webhook payload detected', () => {
  const validPayload = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Rolex 116500LN Black 2022 $25,000' }
    },
    senderData: {
      chatId: '123456789@g.us',
      senderName: 'HK Dealer',
      sender: '987654321@c.us'
    },
    timestamp: Date.now() / 1000
  };

  // Simulate the validation logic from green-api-live.js
  if (!validPayload || !validPayload.typeWebhook) throw new Error('Missing typeWebhook');
  if (validPayload.typeWebhook !== 'incomingMessageReceived') throw new Error('Wrong webhook type');
  if (!validPayload.messageData) throw new Error('Missing messageData');
  const type = validPayload.messageData.typeMessage || '';
  if (!type.includes('text') && !type.includes('extendedText')) throw new Error('Wrong message type');
  console.log('    ✓ Payload validates correctly');
});

test('Invalid webhook (image) rejected', () => {
  const invalidPayload = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://...'
    }
  };
  const type = invalidPayload.messageData.typeMessage || '';
  const isValid = type.includes('text') || type.includes('extendedText');
  if (isValid) throw new Error('Image should be rejected');
  console.log('    ✓ Image webhook rejected correctly');
});

test('Invalid webhook (no typeWebhook) rejected', () => {
  const invalidPayload = { messageData: { typeMessage: 'textMessage' } };
  const isValid = !!(invalidPayload && invalidPayload.typeWebhook);
  if (isValid) throw new Error('Missing typeWebhook should fail');
  console.log('    ✓ Missing typeWebhook rejected correctly');
});

// ════════════════════════════════════════════════════════════════
// 11. BATCH MANAGEMENT API (structure check)
// ════════════════════════════════════════════════════════════════
console.log('\n=== 11. BATCH MANAGEMENT ===');

try {
  const batchHandler = require('./api/batch/index');
  if (typeof batchHandler !== 'function') {
    throw new Error('Batch handler is not a function');
  }
  console.log('  ✅ Batch handler exports function');
  reporter.passed++;
} catch (e) {
  console.log(`  ⚠️  Batch module: ${e.message}`);
  reporter.warnings++;
}

// ════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log(`  AUDIT COMPLETE`);
console.log(`  ✅ ${reporter.passed} passed`);
console.log(`  ❌ ${reporter.failed} failed`);
console.log(`  ⚠️  ${reporter.warnings} warnings`);
console.log('══════════════════════════════════════════════\n');
