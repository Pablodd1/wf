'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { nonReferenceAnchors } = require('./expanded-reference-anchor-policy-v2.cjs');
const v1 = require('./expanded-evidence-candidates.cjs');
const v2 = require('./expanded-evidence-candidates-v2.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function staged(text, extra = {}) {
  const raw = { id: '00000000-0000-4000-8000-000000000002', description: null, title: text, comments: null, type: null, brand: null, model: null, reference: null, is_bundle: 0, ...extra };
  return { source_id: raw.id, source_system: 'fixture', source_database: 'fixture', source_table: 'auctions', source_hash: sha(stableJson(raw)), raw_payload: raw, canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' };
}
function one(text, extra) {
  const input = staged(text, extra), before = stableJson(input);
  const result = v2.buildExpandedCandidates(input);
  assert.equal(result.candidates.length, 1);
  assert.equal(stableJson(input), before);
  assert.equal(v2.verifyExpandedCandidate(input, result.candidates[0]), true);
  return result.candidates[0].candidate;
}
test('short dimensions are excluded but complete AP references and identifier components survive', () => {
  for (const text of ['Ref: 39mm', 'case 39.5 mm', '4.2cm']) assert.equal(nonReferenceAnchors(text).length, 1, text);
  for (const text of ['26585CM', '26585cm 2024 New 555k usdt', 'A39MM', '39mmAB', '26585CM.OO.D002CA.01', 'AB.39MM', '1234mm']) assert.deepEqual(nonReferenceAnchors(text), [], text);
});
test('delivery-labelled selling amount suppresses only the ask token', () => {
  for (const amount of ['9500', '8500', '9600']) {
    const c = one(`2013 Rolex 216570\nSelling:${amount}+label\nDial:white\nSerial:D767\nLinks:10\nWatch card`, { front_image: 'original-object-key' });
    assert.equal(c.fields.reference, '216570');
    assert.equal(c.kind, 'SINGLE');
    assert.equal(c.fields.dial_color, 'White');
    assert.equal(c.fields.original_price_amount, amount);
    assert.equal(c.fields.original_price_currency, null);
    assert.equal(c.fields.price_usd, null);
    assert.deepEqual(c.images.source_image_keys, ['original-object-key']);
    assert.ok(c.decision.price_reasons.includes('CURRENCY_NOT_ESTABLISHED'));
    assert.equal(c.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE');
  }
});
test('bare Selling:number and explicit reference labels are not guessed to be prices', () => {
  for (const text of ['Selling:9500', 'Ref: 9500', 'Rolex 216570 EUR 9500', 'Ref: 9500 EUR', 'Selling: 9500 model']) assert.deepEqual(nonReferenceAnchors(text), [], text);
  const c = one('Selling:9500');
  assert.equal(c.fields.reference, '9500');
  assert.equal(c.fields.original_price_amount, null);
  assert.equal(c.decision.trading_floor, 'REVIEW');
});
test('numeric dimension no longer splits a single watch or loses following condition', () => {
  const c = one('WTB/NTQ\n*Rolex 114300*\nRef: 39mm Grape OP\nCondition: Any\nUsed with card prefer', { front_image: 'unchanged.jpg' });
  assert.equal(c.kind, 'SINGLE'); assert.equal(c.fields.reference, '114300');
  assert.equal(c.fields.condition, 'Used'); assert.equal(c.fields.intent, 'WTB');
  assert.equal(c.evidence.excluded_reference_anchors[0].quote, '39mm');
  assert.equal(c.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE');
});
test('literal EURO price line is preserved exactly and normalized without rounding', () => {
  const c = one('For sale\nRichard Mille RM35-02\nPerfect condition\nWatch / paper 2016\n*205.000 euro*');
  assert.equal(c.kind, 'SINGLE'); assert.equal(c.fields.reference, 'RM35-02');
  assert.equal(c.fields.original_price_amount, '205000');
  assert.equal(c.fields.original_price_currency, 'EUR');
  assert.equal(c.fields.original_price_text, '205.000 euro');
  assert.equal(c.fields.price_usd, null);
  assert.equal(c.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE');
});
test('currency words require full boundaries; no SAR from reference or ambiguous dollar inference', () => {
  for (const text of ['126755SARU', '205.000 EUROPEAN', 'Rolex 216570 EUR 9500']) assert.deepEqual(nonReferenceAnchors(text), []);
  const c = one('Rolex WTS 126755SARU asking $113K');
  assert.equal(c.fields.reference, '126755SARU');
  assert.equal(c.fields.original_price_currency, null);
});
test('whole prefix currency and bare dollar price lines cannot create additional watches', () => {
  for (const [line, expectedAmount, expectedCurrency] of [['Aed 138800', '138800', 'AED'], ['$ 29200', '29200', null], ['13750 $', '13750', null], ['$130000', '130000', null]]) {
    assert.equal(nonReferenceAnchors(line).length, 1);
    const c = one(`WTS Rolex 116500LN\n${line}`);
    assert.equal(c.kind, 'SINGLE'); assert.equal(c.fields.reference, '116500LN');
    assert.equal(c.fields.original_price_amount, expectedAmount);
    assert.equal(c.fields.original_price_currency, expectedCurrency);
    assert.equal(c.fields.price_usd, null);
  }
});
test('original Unicode codepoint evidence remains exact through the corrected anchor', () => {
  const input = staged('😀 WTB Rolex 114300\nRef: ３９\u200cmm\nUsed');
  const c = v2.buildExpandedCandidates(input).candidates[0].candidate;
  const a = c.evidence.excluded_reference_anchors[0];
  assert.equal(a.quote, '３９\u200cmm');
  assert.equal(Array.from(input.raw_payload.title).slice(a.start, a.end).join(''), a.quote);
  assert.equal(sha(a.quote), a.quote_sha256);
  assert.equal(c.kind, 'SINGLE');
});
test('explicit bundles remain children without source images after false-anchor repair', () => {
  const c = one('WTB Rolex 114300\nRef:39mm', { is_bundle: 1, front_image: 'bundle.jpg' });
  assert.equal(c.kind, 'CHILD'); assert.equal(c.images.image_url, null);
  assert.deepEqual(c.images.image_urls, []); assert.equal(c.images.source_image_keys, undefined);
});
test('two actual reference blocks remain two children and retain both complete refs', () => {
  const r = v2.buildExpandedCandidates(staged('Want to buy\n2024 BNIB Rolex ref 126613LB\nPreowned Rolex ref 116503'));
  assert.deepEqual(r.candidates.map(c => c.candidate.fields.reference), ['126613LB', '116503']);
  assert.ok(r.candidates.every(c => c.candidate.kind === 'CHILD'));
});
test('multiple price lines remain ambiguous and package/quantity scope remains held', () => {
  const c = one('WTS Rolex 116500LN\n25000 euro\n26000 euro');
  assert.ok(c.decision.price_reasons.includes('MULTIPLE_PRICE_AMBIGUITY'));
  assert.equal(c.fields.original_price_amount, null);
  for (const wording of ['2 pieces', 'package price']) {
    const held = one(`WTS Rolex 116500LN ${wording}\n25000 euro`);
    assert.equal(held.decision.trading_floor, 'REVIEW');
  }
});
test('standalone currency facts never turn unlabelled amounts into inferred sale intent', () => {
  const c = one('Rolex 116500LN\n25000 euro');
  assert.equal(c.fields.intent, null);
  assert.ok(c.decision.reasons.includes('INTENT_NOT_ESTABLISHED'));
});
test('new dependency and parser version bind corrections; V1 proof cannot authorize V2', () => {
  const input = staged('WTS Rolex 116500LN asking USD 25000');
  const old = v1.buildExpandedCandidates(input).candidates[0];
  const next = v2.buildExpandedCandidates(input).candidates[0];
  assert.notEqual(old.candidate_hash, next.candidate_hash);
  assert.equal(next.candidate.dependency_hashes.base_parser, '32fdd2759767b271a7994b51e59c8abbbeceb9b21e4057acd6d794440e332387');
  assert.throws(() => v2.verifyExpandedCandidate(input, old), /PROOF_MISMATCH/);
});
