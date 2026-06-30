/**
 * Tests for ContextTracker v4.0
 * Run: node api/_lib/test-context-tracker.js
 */
const { ContextTracker, segmentMessage, parseMessageWithContext, convertCurrency } = require('./context-tracker');

let passed = 0;
let failed = 0;

function assert(condition, name, actual, expected) {
  if (condition) {
    passed++;
    // console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertEqual(actual, expected, name) {
  assert(actual === expected, name, actual, expected);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 1: Brand Inheritance ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  // Line 1: Header with PP emoji
  tracker.updateFromLine('🍉🍉 PP Used Full Set 🍉🍉');
  assertEqual(tracker.activeBrand, 'Patek Philippe', 'Brand from PP emoji header');

  // Line 2: Listing without explicit brand — should inherit
  tracker.updateFromLine('5712G Blue 2024 98000usd');
  assertEqual(tracker.activeBrand, 'Patek Philippe', 'Brand inherited on line 2');

  // Line 3: Another listing — should still inherit
  tracker.updateFromLine('5980/1A Black 2023 145000usd');
  assertEqual(tracker.activeBrand, 'Patek Philippe', 'Brand inherited on line 3');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 2: Currency Detection (HKD Bug Fix) ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  // HK flag emoji sets currency to HKD
  tracker.updateFromLine('🇭🇰 PP Ready in HK 🇭🇰');
  assertEqual(tracker.activeCurrency, 'HKD', 'Currency set to HKD from HK flag');

  // Subsequent line should have HKD context
  tracker.updateFromLine('5711 Blue 980000');
  const ctx = tracker.getContext();
  assertEqual(ctx.currency, 'HKD', 'Currency inherited as HKD on line 2');
  assert(ctx.confidence.currency >= 80, 'Currency confidence high', ctx.confidence.currency, '>=80');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 3: Condition Propagation ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  tracker.updateFromLine('PP Used Full Set');
  assertEqual(tracker.activeCondition, 'Full Set', 'Condition set from header');

  tracker.updateFromLine('5712G Blue 98000');
  assertEqual(tracker.activeCondition, 'Full Set', 'Condition inherited');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 4: Model Cache Learning ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  // Line with ref + model name
  tracker.updateFromLine('5712G Nautilus Blue 98000usd');

  // Look up the cached model
  const cached = tracker.lookupModel('5712G');
  assert(cached !== null, 'Model cached from ref+name line', cached, 'not null');
  assertEqual(cached?.model, 'Nautilus', 'Cached model name correct');

  // Lookup by prefix
  const prefixLookup = tracker.lookupModel('5712');
  assert(prefixLookup !== null, 'Model found by prefix', prefixLookup, 'not null');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 5: Message Segmentation ===');
// ═══════════════════════════════════════════════════════════════

{
  // Multi-watch message separated by double newlines
  const msg = `🍉 PP Used Full Set 🍉

5712G Blue 98000usd

5980/1A Black 145000usd

5711 Green 120000usd`;

  const segments = segmentMessage(msg);
  assert(segments.length === 4, 'Multi-watch message split into 4 segments', segments.length, 4);
}

{
  // Emoji-delimited message
  const msg2 = `🏆 Rolex Available 🏆
126610LN Black 13500usd
⭐
126710BLRO Pepsi 16500usd`;

  const segments2 = segmentMessage(msg2);
  assert(segments2.length >= 2, 'Emoji-delimited message split', segments2.length, '>=2');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 6: Full Context-Aware Parse (with mock parser) ===');
// ═══════════════════════════════════════════════════════════════

{
  // Mock parseFull that simulates the real parser behavior
  function mockParse(text) {
    return {
      brand: /patek|rolex/i.test(text) ? null : null,  // Simulate brand not detected
      ref: (text.match(/\d{4,6}[A-Z]?/) || [])[0] || null,
      dial: /blue/i.test(text) ? 'blue' : null,
      condition: null,
      year: null,
      price: parseInt((text.match(/(\d{4,7})/) || [])[1] || '0') || null,
      currency: 'USD',
      confidence: 50,
      fieldConfidence: {},
      listingType: 'WTS',
      accessories: { hasBox: false, hasPapers: false, note: null },
    };
  }

  // Realistic HK dealer message
  const msg = `🇭🇰 PP Ready in HK 🇭🇰

5712G Nautilus Blue 980000

5980/1A Black 1450000`;

  const results = parseMessageWithContext(msg, mockParse);

  assert(results.length === 3, '3 segments parsed', results.length, 3);

  // Line 2: Should inherit HKD and PP brand
  const listing1 = results[1];
  assertEqual(listing1.brand, 'Patek Philippe', 'Brand inherited from context');
  assert(listing1.priceCorrected === true, 'Price corrected from HKD to USD', listing1.priceCorrected, true);
  assert(listing1.price < 980000, 'HKD price converted to USD', listing1.price, '< 980000');

  // Line 3: Should also inherit
  const listing2 = results[2];
  assertEqual(listing2.brand, 'Patek Philippe', 'Brand inherited on line 3');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 7: Currency Conversion ===');
// ═══════════════════════════════════════════════════════════════

{
  const usd = convertCurrency(980000, 'HKD', 'USD');
  assert(usd === 125440, 'HKD→USD conversion', usd, 125440);
  // 980000 * 0.128 = 125440

  const usd2 = convertCurrency(50000, 'EUR', 'USD');
  assert(usd2 === 54000, 'EUR→USD conversion', usd2, 54000);
  // 50000 * 1.08 = 54000
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 8: Static Model Lookup ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  const m1 = tracker.lookupModel('5712G');
  assertEqual(m1?.model, 'Nautilus', 'Static lookup 5712→Nautilus');

  const m2 = tracker.lookupModel('126610LN');
  assertEqual(m2?.model, 'Submariner', 'Static lookup 126610→Submariner');

  const m3 = tracker.lookupModel('15202');
  assertEqual(m3?.model, 'Royal Oak', 'Static lookup 15202→Royal Oak');

  const m4 = tracker.lookupModel('RM011');
  assertEqual(m4?.model, 'Felipe Massa', 'Static lookup RM011→Felipe Massa');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 9: Brand Override (Different Brand Mid-Message) ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  // Start with Rolex
  tracker.updateFromLine('🏆 Rolex Available 🏆');
  assertEqual(tracker.activeBrand, 'Rolex', 'Brand set to Rolex');

  // Switch to Patek
  tracker.updateFromLine('🍉 PP Used Full Set 🍉');
  assertEqual(tracker.activeBrand, 'Patek Philippe', 'Brand switched to Patek');

  // Inherit Patek
  tracker.updateFromLine('5712G Blue 98000usd');
  assertEqual(tracker.activeBrand, 'Patek Philippe', 'Brand still Patek');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== TEST 10: HK Phone Number Currency Detection ===');
// ═══════════════════════════════════════════════════════════════

{
  const tracker = new ContextTracker();

  // WhatsApp signature with HK phone number
  tracker.updateFromLine('Dealer: +852 9876 5432');
  assertEqual(tracker.activeCurrency, 'HKD', 'Currency HKD from +852 phone number');
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
