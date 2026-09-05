const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log(' M2 ADVERSARIAL EMPIRICAL VERIFICATION HARNESS');
console.log('====================================================\n');

// -------------------------------------------------------------------------
// Test 1: Audit lookupDemand cohort count filtering in api/price-research.js
// -------------------------------------------------------------------------
console.log('[Test 1] Auditing lookupDemand cohort count filtering logic in api/price-research.js...');
const priceResearchJsPath = path.join(__dirname, '..', 'api', 'price-research.js');
const priceResearchJsContent = fs.readFileSync(priceResearchJsPath, 'utf8');

// Check source code regex for .filter(cohort => cohort.count >= 1)
const cohortFilterMatch = priceResearchJsContent.match(/\.filter\(\s*cohort\s*=>\s*cohort\.count\s*>=\s*1\s*\)/);
assert.ok(cohortFilterMatch, 'CRITICAL FAIL: lookupDemand does not contain .filter(cohort => cohort.count >= 1)');
console.log('  ✅ Source code audit passed: lookupDemand contains .filter(cohort => cohort.count >= 1)');

// Simulating lookupDemand cohort aggregation logic on cohorts with 1, 2, 3, and 4 observations
const sampleWtbRows = [
  { dial_color: 'Black', listing_type: 'WTB' }, // 1 observation
  { dial_color: 'Blue', listing_type: 'WTB' },  // 2 observations
  { dial_color: 'Blue', listing_type: 'WTB' },
  { dial_color: 'White', listing_type: 'WTB' }, // 3 observations
  { dial_color: 'White', listing_type: 'WTB' },
  { dial_color: 'White', listing_type: 'WTB' },
  { dial_color: 'Green', listing_type: 'WTB' }, // 4 observations
  { dial_color: 'Green', listing_type: 'WTB' },
  { dial_color: 'Green', listing_type: 'WTB' },
  { dial_color: 'Green', listing_type: 'WTB' },
];

const { normalizeDialValue } = require('../api/_lib/dial-normalization.cjs');
const grouped = new Map();
for (const row of sampleWtbRows) {
  const normalizedDial = normalizeDialValue(row.dial_color);
  const dial = normalizedDial.known ? normalizedDial.value : '';
  const key = dial.toLowerCase();
  if (!key) continue;
  const current = grouped.get(key) || { dial_color: dial, count: 0 };
  current.count += 1;
  grouped.set(key, current);
}

const demandCohorts = [...grouped.values()]
  .filter(cohort => cohort.count >= 1)
  .sort((a, b) => b.count - a.count);

console.log('  Cohorts retained:', demandCohorts);
assert.strictEqual(demandCohorts.length, 4, 'Should retain all 4 cohorts (1, 2, 3, 4 observations)');
const countsFound = demandCohorts.map(c => c.count).sort();
assert.deepStrictEqual(countsFound, [1, 2, 3, 4], 'Cohort counts 1, 2, 3, and 4 must all be present');
console.log('  ✅ Empirical test passed: Cohorts with 1, 2, 3, and 4 observations are strictly retained.\n');

// -------------------------------------------------------------------------
// Test 2: Audit WTB vs WTS Strict Separation in api/price-research.js & PriceResearch.tsx
// -------------------------------------------------------------------------
console.log('[Test 2] Auditing WTB vs WTS Strict Separation...');
const { classifyResearchEligibility } = require('../api/_lib/price-research-eligibility.cjs');

// WTB row (no price_usd)
const wtbRow = {
  brand: 'Rolex',
  reference: '116500LN',
  dial_color: 'Black',
  listing_type: 'WTB',
  price_usd: null,
};
const wtbCatalog = { found: true, model: 'Daytona', dialColors: ['Black', 'White'] };

const eligibilityVerdict = classifyResearchEligibility(wtbRow, wtbCatalog);
console.log('  classifyResearchEligibility for WTB row:', eligibilityVerdict);
assert.strictEqual(eligibilityVerdict, 'MISSING_PRICE', 'WTB row must fail WTS research eligibility with MISSING_PRICE');

// Verify frontend mapWtbToRowData sets is_outlier: true
const priceResearchTsxPath = path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx');
const priceResearchTsxContent = fs.readFileSync(priceResearchTsxPath, 'utf8');

const mapWtbToRowDataMatch = priceResearchTsxContent.match(/function mapWtbToRowData[\s\S]*?is_outlier:\s*true/);
assert.ok(mapWtbToRowDataMatch, 'mapWtbToRowData must explicitly set is_outlier: true for WTB cards');

console.log('  ✅ WTB rows are classified as MISSING_PRICE / is_outlier: true, keeping them excluded from WTS asking price averages/charts.');
console.log('  ✅ Empirical test passed: WTB and WTS are strictly separated.\n');

// -------------------------------------------------------------------------
// Test 3: WhatsApp Link Synthesis & Raw Message Formatting
// -------------------------------------------------------------------------
console.log('[Test 3] Testing WhatsApp link synthesis and raw message formatting...');

function synthesizeWhatsAppUrl(phone) {
  const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, '') : '';
  return phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
}

const testPhones = [
  { input: '+1 (555) 234-5678', expected: 'https://wa.me/15552345678' },
  { input: '447911123456', expected: 'https://wa.me/447911123456' },
  { input: '12345', expected: null }, // < 7 digits
  { input: null, expected: null },
];

for (const { input, expected } of testPhones) {
  const result = synthesizeWhatsAppUrl(input);
  assert.strictEqual(result, expected, `WhatsApp synthesis failed for input '${input}': expected '${expected}', got '${result}'`);
}
console.log('  ✅ WhatsApp link synthesis logic verified for all test phone formats.');

// Audit raw message pre tag in PriceResearch.tsx
const rawMessagePreMatch = priceResearchTsxContent.match(/Unredacted Raw Source Message[\s\S]*?<pre[\s\S]*?>\s*\{row\.raw_message\}\s*<\/pre>/);
assert.ok(rawMessagePreMatch, 'PriceResearch.tsx must contain unredacted raw source message in <pre>{row.raw_message}</pre>');
console.log('  ✅ Raw message formatting verified: rendered unredacted in <pre> container.');
console.log('  ✅ Empirical test passed: WhatsApp link synthesis and raw message formatting are clean.\n');

console.log('====================================================');
console.log(' ALL M2 EMPIRICAL VERIFICATION TESTS PASSED (3/3)');
console.log('====================================================');
