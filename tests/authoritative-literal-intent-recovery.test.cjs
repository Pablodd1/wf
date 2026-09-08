'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeAuthoritativeRow, resolveStrictIntentFromText, resolveLiteralIntentEvidence } = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');
const { capturedFixture } = require('./helpers/captured-fixture.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const staged = (text, raw = {}) => capturedFixture({
  source_id: 'literal-intent-fixture', source_hash: 'a'.repeat(64),
  source_system: 'OceanDigital MariaDB', source_database: 'thecollective_inventory',
  source_table: 'auctions', source_record_id: 'fixture-literal-intent',
  raw_payload: { title: text, ...raw }
});

test('Unicode formatting reveals literal intent and preserves original source evidence', () => {
  const text = 'L\u200dooking fo\ufeffr Rolex 126610LN USD 14000';
  const row = staged(text, { type: 'sale', front_image: 'original-image.jpg' });
  const before = JSON.stringify(row);
  const result = normalizeAuthoritativeRow(row);
  assert.equal(result.intent, 'WTB');
  assert.equal(result.listing_text_evidence, text);
  assert.equal(result.listing_text_sha256, hash(text));
  assert.equal(result.source_hash, row.source_hash);
  assert.equal(result.original_price_amount, 14000);
  assert.equal(result.image_key, 'original-image.jpg');
  assert.equal(result.intent_parsing_evidence.source_text_sha256, hash(text));
  assert.equal(JSON.stringify(row), before);
  assert.equal(result.parser_version, 'authoritative-normalizer-v12-literal-intent');
});

test('fullwidth literal WTS and an anchored spaced WTB/WTS header are supported', () => {
  assert.equal(resolveStrictIntentFromText('ＷＴＳ Rolex 126610LN'), 'WTS');
  assert.equal(resolveStrictIntentFromText('🚨 W T B\n126519 LN\n2023'), 'WTB');
  assert.equal(resolveStrictIntentFromText('W T S: Rolex 126610LN'), 'WTS');
  assert.equal(resolveStrictIntentFromText('W\tT\tB Rolex 126610LN'), 'WTB');
});

test('spaced abbreviations must be a header and are not inferred from full-set text', () => {
  for (const text of ['Rolex W T B 126610LN', 'W T Baggage', 'W\nT\nB Rolex 126610LN', 'W.T.S Rolex 126610LN', '77450OR salmon new F.S 735KHKD', '出售价格投诉']) {
    assert.equal(resolveStrictIntentFromText(text), null, text);
  }
});

test('opposing explicit or formatting-obscured markers stay ambiguous', () => {
  for (const text of ['W T B Rolex 126610LN for sale', 'WTS Rolex 126610LN; L\u200dooking for 124060', 'ＷＴＳ WTB Rolex 126610LN', 'NTQ279178 for sale']) {
    assert.equal(resolveStrictIntentFromText(text), null, text);
  }
});

test('attached NTQ preserves an entire source reference with suffixes', () => {
  const text = 'NTQ15210OR.OO.A348KB.01!';
  const result = normalizeAuthoritativeRow(staged(text, { brand: 'Audemars Piguet' }));
  assert.equal(result.intent, 'WTB');
  assert.equal(result.reference, '15210OR.OO.A348KB.01');
  assert.equal(result.reference_source_evidence, 'listing_text_attached_ntq_exact_reference');
  assert.equal(result.listing_text_evidence, text);
  assert.equal(result.intent_parsing_evidence.attached_reference, result.reference);
  assert.equal(resolveStrictIntentFromText('ntq279178 bnib or preowned om tia !'), 'WTB');
});

test('attached headers reject partial extraction, multiple identities and quantity requests', () => {
  for (const text of ['NTQ3510.50.00', 'NTQ279178 or 126610LN', 'NTQ279178 RM07-01', 'NTQ279178 2pcs', 'NTQ279178 x2', 'NTQ279178 qty: 2', 'WTB279178', 'WTS279178', 'NTQ279178.unknown']) {
    assert.equal(resolveStrictIntentFromText(text), null, text);
    assert.equal(resolveLiteralIntentEvidence(text).attached_reference, null, text);
  }
});

test('formatting intent repair does not silently repair a separate identity or raw metadata intent', () => {
  const text = 'L\u200dooking for F.P. Journe';
  const result = normalizeAuthoritativeRow(staged(text, { type: 'sale' }));
  assert.equal(result.intent, 'WTB');
  assert.equal(result.reference, null);
  assert.equal(result.trading_floor_eligible, false);
  assert.equal(normalizeAuthoritativeRow(staged('Rolex 126610LN', { type: 'sale' })).intent, null);
  assert.equal(normalizeAuthoritativeRow(staged('Rolex 126610LN', { type: 'search' })).intent, null);
});

test('unchanged valid intent retains its historical parser contract', () => {
  const result = normalizeAuthoritativeRow(staged('WTB Rolex 126610LN'));
  assert.equal(result.parser_version, 'authoritative-normalizer-v11-category-bound');
  assert.equal(result.intent_parsing_evidence, undefined);
});

test('recovered intent cannot publish a reference truncated by invisible formatting', () => {
  const result = normalizeAuthoritativeRow(staged('Looking F\ufeffor Rolex 126678SAJO\u2060R-0003 - New 2026'));
  assert.equal(result.intent, 'WTB');
  assert.equal(result.trading_floor_eligible, false);
  assert.ok(result.exclusion_reasons.includes('RECOVERED_INTENT_REFERENCE_TOKEN_INCOMPLETE'));
});

test('recovered intent still holds multiple references, all-model requests and separated suffixes', () => {
  for (const text of ['𝐋𝐎𝐎𝐊𝐈𝐍𝐆 𝐅𝐎𝐑 Patek 5089R 5738 5077', '𝐋𝐎𝐎𝐊𝐈𝐍𝐆 𝐅𝐎𝐑 Patek 5270P All Model', 'W T B Rolex 126519 LN']) {
    const result = normalizeAuthoritativeRow(staged(text));
    assert.equal(result.intent, 'WTB');
    assert.equal(result.trading_floor_eligible, false, text);
    assert.ok(result.exclusion_reasons.some(reason => reason.startsWith('RECOVERED_INTENT_')), text);
  }
});

test('attached NTQ cannot promote contradictory or uncorroborated metadata to a manufacturer', () => {
  for (const [text, raw, reference] of [
    ['Ntq116000', { brand: 'Hublot', reference: 'HUBLOT', model: 'Wooden Model' }, '116000'],
    ['ntq279178 bnib or preowned om tia !', { brand: 'Rolex', reference: '279178', model: 'Datejust' }, '279178'],
    ['NTQ279178 Hublot', {}, '279178'],
    ['NTQ279178 Rolexish', { brand: 'Rolex', reference: '279178' }, '279178']
  ]) {
    const row = staged(text, { ...raw, front_image: 'original-ntq.jpg' });
    const original = JSON.stringify(row);
    const result = normalizeAuthoritativeRow(row);
    assert.equal(result.intent, 'WTB');
    assert.equal(result.reference, reference);
    assert.equal(result.intent_parsing_evidence.attached_reference, reference);
    assert.equal(result.trading_floor_status, 'HELD_IDENTITY_INCOMPLETE');
    assert.equal(result.trading_floor_eligible, false);
    assert.equal(result.price_research_eligible, false);
    assert.ok(result.exclusion_reasons.includes('RECOVERED_INTENT_MANUFACTURER_SOURCE_EVIDENCE_MISSING'), text + ': ' + JSON.stringify(result.exclusion_reasons));
    assert.equal(result.listing_text_evidence, text);
    assert.equal(result.listing_text_sha256, hash(text));
    assert.equal(result.image_key, 'original-ntq.jpg');
    assert.equal(result.image_url, null);
    assert.equal(JSON.stringify(row), original);
  }
});

test('attached NTQ with a bounded matching source manufacturer remains eligible', () => {
  const text = 'NTQ279178 Rolex bnib';
  const result = normalizeAuthoritativeRow(staged(text, { brand: 'Hublot', reference: 'HUBLOT' }));
  assert.equal(result.intent, 'WTB');
  assert.equal(result.reference, '279178');
  assert.equal(result.brand, 'Rolex');
  assert.equal(result.trading_floor_status, 'ELIGIBLE_WTB');
  assert.equal(result.trading_floor_eligible, true);
  assert.equal(result.price_research_eligible, false);
  assert.equal(result.listing_text_evidence, text);
  assert.equal(result.listing_text_sha256, hash(text));
});
