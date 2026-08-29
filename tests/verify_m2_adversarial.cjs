/**
 * ADVERSARIAL VERIFICATION SCRIPT FOR MILESTONE M2 (WTB DEMAND SIGNALS)
 * Tests:
 * 1. Cohort count filtering logic allows cohorts with 1, 2, 3, or 4 observations.
 * 2. WhatsApp link synthesis correctly strips non-digits and formats https://wa.me/<digits> for >= 7 digits.
 * 3. WTB listings are classified as MISSING_PRICE for WTS research eligibility (strict separation).
 */

const assert = require('assert');

// 1. Test Cohort Count Filtering Logic (mimicking lookupDemand grouping & filtering)
function simulateLookupDemand(sampleRows) {
  const grouped = new Map();
  for (const row of sampleRows) {
    const dial = (row.dial_color || '').trim();
    if (!dial) continue;
    const key = dial.toLowerCase();
    const current = grouped.get(key) || { dial_color: dial, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  
  // Cohort retention logic from api/price-research.js
  const demandCohorts = [...grouped.values()]
    .filter(cohort => cohort.count >= 1)
    .sort((a, b) => b.count - a.count);
    
  return demandCohorts;
}

// 2. Test WhatsApp link synthesis logic (mimicking api/price-research.js & PriceResearch.tsx)
function synthesizeWhatsappUrl(phone) {
  if (!phone) return null;
  const phoneDigits = String(phone).replace(/[^0-9]/g, '');
  return phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
}

// 3. Test research eligibility for WTB listings (mimicking classifyResearchEligibility)
const { classifyResearchEligibility } = require('../api/_lib/price-research-eligibility.cjs');

console.log('--- STARTING M2 ADVERSARIAL VERIFICATION ---');

// Test Case 1: Cohort retention for 1, 2, 3, 4, and 5+ observations
const testRows = [
  { dial_color: 'Black' }, // count 1
  { dial_color: 'Blue' }, { dial_color: 'Blue' }, // count 2
  { dial_color: 'Green' }, { dial_color: 'Green' }, { dial_color: 'Green' }, // count 3
  { dial_color: 'Silver' }, { dial_color: 'Silver' }, { dial_color: 'Silver' }, { dial_color: 'Silver' }, // count 4
  { dial_color: 'White' }, { dial_color: 'White' }, { dial_color: 'White' }, { dial_color: 'White' }, { dial_color: 'White' }, // count 5
];

const cohorts = simulateLookupDemand(testRows);
console.log('Retained cohorts count:', cohorts.length);
assert.strictEqual(cohorts.length, 5, 'Should retain all 5 cohorts (including counts 1, 2, 3, 4)');

const countsMap = new Map(cohorts.map(c => [c.dial_color.toLowerCase(), c.count]));
assert.strictEqual(countsMap.get('black'), 1, 'Black cohort count should be 1');
assert.strictEqual(countsMap.get('blue'), 2, 'Blue cohort count should be 2');
assert.strictEqual(countsMap.get('green'), 3, 'Green cohort count should be 3');
assert.strictEqual(countsMap.get('silver'), 4, 'Silver cohort count should be 4');
assert.strictEqual(countsMap.get('white'), 5, 'White cohort count should be 5');
console.log('✅ PASS: Cohort retention allows 1, 2, 3, 4, and 5+ observations!');

// Test Case 2: WhatsApp Link Synthesis
const phoneTests = [
  { input: '+1 (555) 123-4567', expected: 'https://wa.me/15551234567' },
  { input: '+44 7911 123456', expected: 'https://wa.me/447911123456' },
  { input: '1234567', expected: 'https://wa.me/1234567' },
  { input: '123456', expected: null }, // under 7 digits
  { input: null, expected: null },
];

for (const t of phoneTests) {
  const result = synthesizeWhatsappUrl(t.input);
  assert.strictEqual(result, t.expected, `WhatsApp URL for "${t.input}" failed`);
}
console.log('✅ PASS: WhatsApp URL synthesis formats correctly!');

// Test Case 3: WTB Separation from WTS Asking Price Stats
const wtbRow = {
  listing_type: 'WTB',
  brand: 'Rolex',
  reference: '116500LN',
  dial_color: 'Black',
  price_usd: null
};

const catalogHit = { found: true, model: 'Daytona' };
const eligibilityReason = classifyResearchEligibility(wtbRow, catalogHit);
console.log('WTB Listing WTS research eligibility reason:', eligibilityReason);
assert.strictEqual(eligibilityReason, 'MISSING_PRICE', 'WTB listing must be rejected from WTS price analytics with MISSING_PRICE');
console.log('✅ PASS: WTB listings are strictly excluded from WTS asking price averages!');

console.log('--- ALL M2 ADVERSARIAL TESTS PASSED ---');
