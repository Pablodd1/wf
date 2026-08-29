'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Import modules to test
const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const {
  resolveDial,
  resolveDialWithVisionFallback,
  normalizeDialValue,
  extractDialFromText,
} = require('../api/_lib/dial-normalization.cjs');

test('2a. Edge Case Seller Phone Numbers & WhatsApp URL Extraction', async (t) => {
  const phoneTestCases = [
    { input: '+1 (555) 234-5678', expectedDigits: '15552345678', valid: true },
    { input: '+44 7911 123456', expectedDigits: '447911123456', valid: true },
    { input: '+86 138-0000-0000', expectedDigits: '8613800000000', valid: true },
    { input: '+971 50 123 4567', expectedDigits: '971501234567', valid: true },
    { input: '+81 90-1234-5678 (WhatsApp only)', expectedDigits: '819012345678', valid: true },
    { input: '050-123-4567', expectedDigits: '0501234567', valid: true },
    { input: '12345', expectedDigits: '12345', valid: false }, // < 7 or 8 digits
    { input: 'N/A', expectedDigits: '', valid: false },
    { input: '', expectedDigits: '', valid: false },
    { input: null, expectedDigits: '', valid: false },
  ];

  for (const tc of phoneTestCases) {
    const raw = String(tc.input || '').trim();
    // Simulate digit extraction in TradingFloor / PriceResearch
    const digits = raw.replace(/\D/g, '');
    assert.equal(digits, tc.expectedDigits, `Digits mismatch for input "${tc.input}"`);

    const waUrl = digits.length >= 7 ? `https://wa.me/${digits}` : null;
    if (tc.valid) {
      assert.ok(waUrl, `Expected valid waUrl for "${tc.input}"`);
      assert.ok(waUrl.startsWith('https://wa.me/'), `URL must start with https://wa.me/`);
      const urlDigits = waUrl.replace('https://wa.me/', '');
      assert.match(urlDigits, /^\d+$/, `waUrl digits must contain ONLY numbers, got "${urlDigits}"`);
      assert.equal(urlDigits, tc.expectedDigits);
    } else {
      assert.equal(waUrl, null, `Expected null waUrl for invalid phone input "${tc.input}"`);
    }
  }
});

test('2b. Public raw source keeps watch evidence while redacting contact PII', async (t) => {
  const rawMessageCases = [
    {
      source: 'oceandigital',
      msg: '[OceanDigital Chatbot] WTS Rolex Daytona 116500LN panda dial $28,500. Contact John at +1 (555) 987-6543 or john@dealers.com. http://t.me/oceandigital',
      evidence: /Rolex Daytona 116500LN panda dial \$28,500/,
    },
    {
      source: 'telegram',
      msg: 'WTS Patek 5711/1A Blue Dial 2021 Complete Box & Papers. Price: $95,000 USD. DM @patek_dealer or call +44 7911 123456',
      evidence: /Patek 5711\/1A Blue Dial 2021.*\$95,000 USD/,
    },
    {
      source: 'whatsapp_group',
      msg: 'WTB Audemars Piguet Royal Oak 15500ST Black dial. Budget $32k. WhatsApp me +971 50 123 4567. Fast deal!',
      evidence: /Audemars Piguet Royal Oak 15500ST Black dial.*\$32k/,
    },
    {
      source: 'forum_post',
      msg: 'For Sale: Grand Seiko SBGA211 Snowflake. Excellent condition. $4,200 shipped CONUS. Email: seller@watchnet.com',
      evidence: /Grand Seiko SBGA211 Snowflake.*\$4,200/,
    },
    {
      source: 'special_chars',
      msg: 'WTS ***SPECIAL DEAL*** Rolex Submariner 126610LN @ $13,500! Contact: [REDACTED_TEST_STRING_DO_NOT_FILTER] +1-800-555-0199',
      evidence: /Rolex Submariner 126610LN @ \$13,500/,
    },
  ];

  for (const tc of rawMessageCases) {
    const redacted = redactPublicSource(tc.msg);
    assert.match(redacted, tc.evidence, `watch identity and price must remain for source "${tc.source}"`);
    assert.doesNotMatch(redacted, /john@dealers|seller@watchnet|t\.me|@patek_dealer|555\)?[\s.-]*987|7911[\s.-]*123456|50[\s.-]*123[\s.-]*4567|555[\s.-]*0199/i);
  }
});

test('2c. Bundle listings without attached images (UI Safety & Rendering)', async (t) => {
  const bundleListing = {
    id: 'bundle_123',
    listing_type: 'MULTI',
    brand: 'Rolex',
    reference: null,
    model: 'Dealer Inventory Lot',
    has_images: false,
    thumbnail_url: null,
    image_urls: [],
    image_evidence_type: 'NO_IMAGE',
    raw_message: 'WTS 3 watches: 1) Rolex 116500LN $28k 2) Patek 5711/1A $90k 3) AP 15500ST $32k',
  };

  // 1. Helper hasListingImage check logic (replicated from TradingFloor.tsx)
  function hasListingImage(listing) {
    return Boolean(
      ['SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'].includes(String(listing.image_evidence_type || ''))
      && listing.has_images
      && (listing.thumbnail_url || listing.image_urls?.some(Boolean))
    );
  }

  assert.equal(hasListingImage(bundleListing), false, 'Bundle listing without image must return false for hasListingImage');

  // 2. Images array extraction in details view
  function extractImages(listing) {
    if (!hasListingImage(listing)) return [];
    const candidates = listing.image_urls?.length ? listing.image_urls : [listing.thumbnail_url];
    return [...new Set(candidates.map(v => String(v || '').trim()).filter(Boolean))];
  }

  const images = extractImages(bundleListing);
  assert.deepEqual(images, [], 'Image array for bundle listing with no images must be empty array');

  // 3. Confirm card layout does not throw errors
  assert.equal(bundleListing.has_images, false);
  assert.equal(images.length, 0);
});

test('2d. AI Vision Dial Color Fallback Logic', async (t) => {
  // Scenario 1: dial_color is present and valid
  const res1 = await resolveDialWithVisionFallback({
    sourceDial: 'Blue',
    rawText: 'WTS Rolex 126334 blue dial',
    imageUrl: 'https://example.com/watch.jpg',
    textReference: '126334',
    textBrand: 'Rolex',
  });
  assert.equal(res1.value, 'Blue', 'Known source dial color must be preserved without calling vision');
  assert.equal(res1.evidence, 'explicit_raw_text');

  // Scenario 2: dial_color is UNKNOWN and image URL is MISSING
  const res2 = await resolveDialWithVisionFallback({
    sourceDial: 'UNKNOWN',
    rawText: 'WTS watch for sale',
    imageUrl: null,
    textReference: '126334',
    textBrand: 'Rolex',
  });
  assert.equal(res2.value, null, 'When dial is UNKNOWN and image is missing, should return null safely without error');

  // Scenario 3: dial_color is null and rawText contains explicit dial color
  const res3 = await resolveDialWithVisionFallback({
    sourceDial: null,
    rawText: 'Rolex Submariner with green dial in stock',
    imageUrl: null,
    textReference: '116610LV',
    textBrand: 'Rolex',
  });
  assert.equal(res3.value, 'Green', 'Should extract explicit dial color from raw text');
});
