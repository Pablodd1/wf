'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCorrectionManifest,
  sha256,
} = require('../tools/audit/build-cartier-zenith-missing-field-manifest.cjs');

const catalog = [
  { brand: 'Cartier', reference: 'WSBB0071', model: 'Ballon Bleu' },
  { brand: 'Cartier', reference: 'W2006951', model: 'Santos 100' },
  { brand: 'Zenith', reference: '49.4001.3620.63.I001', model: 'Pilot' },
  { brand: 'Zenith', reference: '03.2280.400/91.R576', model: 'El Primero' },
  { brand: 'Zenith', reference: '97.9100.9004/02.I001', model: 'Defy' },
];

test('manifest proposes only currently blank fields with immutable evidence and hashes', () => {
  const raw = 'Cartier Ballon Bleu Green Dial Ref W2006951 brand new 7400USD';
  const manifest = buildCorrectionManifest([{
    id: 'cartier-1', brand: 'Cartier', model: 'Ballon Bleu', reference: null,
    dial_color: null, condition: null, price_usd: null, listing_type: 'WTS',
    raw_message: raw, has_images: false, thumbnail_url: null,
  }], catalog);
  assert.deepEqual(manifest.corrections.map(item => [item.field, item.proposed_value]), [
    ['condition', 'New'],
    ['dial_color', 'Green'],
    ['price_usd', 7400],
    ['reference', 'W2006951'],
  ]);
  assert.equal(manifest.corrections.every(item => item.current_value === null), true);
  assert.equal(manifest.corrections.every(item => item.raw_message_sha256 === sha256(raw)), true);
  assert.equal(manifest.corrections.every(item => item.evidence_quote.length > 0), true);
});

test('confirmed fields are never overwritten and non-target brands are ignored', () => {
  const manifest = buildCorrectionManifest([
    { id: 'zenith-confirmed', brand: 'Zenith', model: 'Defy', reference: 'ABC', dial_color: 'Blue', condition: 'Used', price_usd: 9000, listing_type: 'WTS', raw_message: 'Zenith Pilot green dial brand new 10000USD', has_images: true },
    { id: 'omega-ignored', brand: 'Omega', model: null, reference: null, raw_message: 'Omega 310.30.42.50.01.001 9000USD' },
  ], catalog);
  assert.equal(manifest.corrections.length, 0);
  assert.equal(manifest.owner_policy_tracked_only.length, 0);
});

test('one bare dollar amount is isolated as tracked-only owner policy evidence', () => {
  const manifest = buildCorrectionManifest([{
    id: 'cartier-dollar', brand: 'Cartier', model: 'Santos 100', reference: 'W2006951',
    dial_color: 'White', condition: 'Used', price_usd: null, listing_type: 'WTS',
    raw_message: 'Cartier W2006951 watch only $4,999.99', has_images: false,
  }], catalog);
  assert.equal(manifest.corrections.length, 0);
  assert.equal(manifest.owner_policy_tracked_only.length, 1);
  assert.equal(manifest.owner_policy_tracked_only[0].proposed_value, 4999.99);
  assert.equal(manifest.owner_policy_tracked_only[0].price_evidence_status, 'OWNER_ASSUMED_USD');
  assert.equal(manifest.owner_policy_tracked_only[0].analytics_admission, 'TRACKED_ONLY_NOT_INDEPENDENTLY_QUALIFIED');
});

test('competing prices, bare NEW, and ambiguous model names remain blocked', () => {
  const manifest = buildCorrectionManifest([{
    id: 'zenith-ambiguous', brand: 'Zenith', model: null, reference: null,
    dial_color: null, condition: null, price_usd: null, listing_type: 'WTS',
    raw_message: 'Zenith Defy El Primero NEW retail $18,600 asking $11,160', has_images: false,
  }], catalog);
  assert.equal(manifest.corrections.length, 0);
  assert.equal(manifest.owner_policy_tracked_only.length, 0);
  assert.ok(manifest.blockers.some(item => item.field === 'model'));
  assert.ok(manifest.blockers.some(item => item.field === 'condition'));
  assert.ok(manifest.blockers.some(item => item.field === 'price_usd'));
});

test('accessory condition words and retail-only prices cannot populate watch fields', () => {
  const manifest = buildCorrectionManifest([{
    id: 'cartier-accessory', brand: 'Cartier', model: 'Santos 100', reference: 'W2006951',
    dial_color: 'White', condition: null, price_usd: null, listing_type: 'WTS',
    raw_message: 'Cartier W2006951 good condition used strap Retail $8,000', has_images: false,
  }], catalog);
  assert.equal(manifest.corrections.length, 0);
  assert.equal(manifest.owner_policy_tracked_only.length, 0);
  assert.ok(manifest.blockers.some(item => item.field === 'condition'));
  assert.ok(manifest.blockers.some(item => item.field === 'price_usd'));
});

test('a raw-message image URL is not enough without an exact attachment-ledger link', () => {
  const url = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/example.jpg';
  const manifest = buildCorrectionManifest([{
    id: 'zenith-image', brand: 'Zenith', model: 'Pilot', reference: '49.4001.3620.63.I001',
    dial_color: 'Green', condition: 'New', price_usd: 5900, listing_type: 'WTS',
    raw_message: `Zenith exact source ${url}`, has_images: false, thumbnail_url: null,
  }], catalog);
  assert.equal(manifest.corrections.some(item => item.field === 'thumbnail_url'), false);
  assert.ok(manifest.blockers.some(item => item.field === 'thumbnail_url'
    && item.reason === 'NO_EXACT_ATTACHMENT_LEDGER_LINK'));
});
