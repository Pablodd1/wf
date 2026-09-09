'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { buildExpandedCandidates, verifyExpandedCandidate } = require('./expanded-evidence-candidates.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function staged(text, extra = {}) {
  const raw = { id: '00000000-0000-4000-8000-000000000001', description: null, title: text, comments: null, type: null, brand: null, model: null, reference: null, is_bundle: 0, ...extra };
  return { source_id: raw.id, source_system: 'fixture', source_database: 'fixture', source_table: 'auctions', source_hash: sha(stableJson(raw)), raw_payload: raw, canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' };
}
function one(text, extra) {
  const result = buildExpandedCandidates(staged(text, extra));
  assert.equal(result.candidates.length, 1, JSON.stringify(result.residuals.map(r => r.reason)));
  return result.candidates[0].candidate;
}
const supported = c => assert.equal(c.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE', c.decision.reasons.join(','));
const held = (c, reason) => assert.ok(c.decision.reasons.includes(reason), JSON.stringify(c.decision));

test('explicit WTS, exact reference, price decimals and immutable source spans', () => {
  const input = staged('Rolex WTS 116500LN asking USD 25000.25');
  const before = stableJson(input);
  const result = buildExpandedCandidates(input), c = result.candidates[0].candidate;
  supported(c);
  assert.equal(c.fields.original_price_amount, '25000.25');
  assert.equal(c.fields.original_price_currency, 'USD');
  assert.equal(c.fields.price_usd, null);
  assert.equal(c.intent_evidence_tier, 'EXPLICIT_MESSAGE');
  assert.equal(stableJson(input), before);
  assert.ok(verifyExpandedCandidate(input, result.candidates[0]));
});

test('explicit WTB budget remains visible and never enters sale analytics', () => {
  const c = one('WTB Rolex 116500LN budget EUR 24000');
  supported(c);
  assert.equal(c.fields.original_price_amount, '24000');
  assert.equal(c.fields.original_price_currency, 'EUR');
  assert.equal(c.fields.original_price_role, 'WTB_BUDGET');
  assert.ok(c.decision.price_reasons.includes('NOT_WTS_ASKING_PRICE'));
});

test('nonconflicting source sale/search establishes intent; missing price does not', () => {
  for (const [type, expected] of [['sale', 'WTS'], ['search', 'WTB']]) {
    const c = one('Rolex 116500LN', { type }); supported(c);
    assert.equal(c.fields.intent, expected);
    assert.equal(c.intent_evidence_tier, 'NONCONFLICTING_SOURCE_TYPE');
    assert.equal(c.evidence.intent[0].field, 'type');
  }
  const c = one('Rolex 116500LN');
  held(c, 'INTENT_NOT_ESTABLISHED'); assert.equal(c.fields.intent, null);
});

test('clear asking price supports sale inference but retail or budget never does', () => {
  const c = one('Rolex 116500LN asking USD 25,000'); supported(c);
  assert.equal(c.intent_evidence_tier, 'CLEAR_ASKING_PRICE_INFERENCE');
  for (const label of ['retail', 'budget', 'RRP', 'paid']) {
    const other = one(`Rolex 116500LN ${label} USD 25,000`);
    held(other, 'INTENT_NOT_ESTABLISHED');
  }
});

test('explicit intent overrides legacy type; conflicting message cues cannot use fallback', () => {
  const override = one('WTB Rolex 116500LN', { type: 'sale' }); supported(override);
  assert.equal(override.fields.intent, 'WTB');
  assert.ok(override.decision.warnings.includes('SOURCE_TYPE_CONFLICT_OVERRIDDEN_BY_EXPLICIT_MESSAGE'));
  const c = one('WTB WTS Rolex 116500LN asking USD 25000', { type: 'sale' });
  held(c, 'CONFLICTING_MESSAGE_INTENT'); assert.equal(c.fields.intent, null);
  held(one('Rolex 116500LN not for sale', { type: 'sale' }), 'CONFLICTING_MESSAGE_INTENT');
  held(one('Rolex 116500LN asking USD 25000', { type: 'search' }), 'INTENT_PRICE_ROLE_CONFLICT');
});

test('explicit child intent overrides an inherited section with both proofs preserved', () => {
  const c = one('Rolex\nWTS\nWTB 116500LN', { is_bundle: 1, type: 'sale' }); supported(c);
  assert.equal(c.fields.intent, 'WTB');
  assert.ok(c.decision.warnings.includes('SECTION_INTENT_OVERRIDDEN_BY_EXPLICIT_CHILD_MESSAGE'));
  assert.ok(c.context_spans.some(s => s.role === 'SECTION_INTENT' && s.quote === 'WTS'));
  assert.equal(c.evidence.intent[0].quote, 'WTB');
});

test('explicit child maker overrides one parent-level maker tag in a mixed list', () => {
  const r = buildExpandedCandidates(staged('Rolex\nWTS\n116500LN\nPatek Philippe\n5712/1A', { is_bundle: 1, brand: 'Rolex' }));
  assert.equal(r.candidates.length, 2); r.candidates.forEach(c => supported(c.candidate));
  assert.equal(r.candidates[1].candidate.fields.brand, 'Patek Philippe');
  assert.ok(r.candidates[1].candidate.decision.warnings.includes('PARENT_METADATA_MAKER_NOT_APPLIED_TO_CHILD'));
});

test('modification wording remains visible and held from comparable analytics', () => {
  for (const modifier of ['aftermarket', 'customized', 'iced out', 'bustdown', 'non-factory']) {
    const c = one(`WTS Rolex 116500LN ${modifier} asking USD 25000`); supported(c);
    assert.ok(c.decision.warnings.includes('SOURCE_DISCLOSED_MODIFICATION'));
    assert.ok(c.decision.price_reasons.includes('MODIFIED_CONFIGURATION_RESEARCH_REVIEW'));
    assert.equal(c.fields.original_price_amount, '25000');
  }
});

test('bare dollars retain exact amount with unknown currency and no USD fallback', () => {
  const c = one('Rolex WTS 116500LN asking $25000'); supported(c);
  assert.equal(c.fields.original_price_amount, '25000');
  assert.equal(c.fields.original_price_currency, null);
  assert.equal(c.fields.price_usd, null);
  assert.ok(c.decision.price_reasons.includes('CURRENCY_NOT_ESTABLISHED'));
});

test('explicit decimal shorthand does not round a genuine fractional price', () => {
  const c = one('Rolex WTS 116500LN asking USD 25.00025k'); supported(c);
  assert.equal(c.fields.original_price_amount, '25000.25');
  assert.equal(c.evidence.price_numeric.scale_token, 'k');
});

test('section maker, currency and intent produce children with exact context and no images', () => {
  const input = staged('Rolex\nWTS\nUSD\n116500LN asking $25000\n126610LN asking $14000', { is_bundle: 1, front_image: 'parent.jpg', image: 'parent-other.jpg', back_image: 'parent-back.jpg' });
  const before = stableJson(input), result = buildExpandedCandidates(input);
  assert.equal(result.candidates.length, 2);
  result.candidates.forEach(({ candidate: c }, index) => {
    supported(c); assert.equal(c.kind, 'CHILD'); assert.equal(c.child_index, index + 1);
    assert.equal(c.fields.original_price_currency, 'USD');
    assert.ok(c.context_spans.some(s => s.role === 'SECTION_MAKER'));
    for (const value of Object.values(c.images)) assert.ok(value === null || (Array.isArray(value) && !value.length));
    assert.ok(!c.source_context_text.includes('parent.jpg'));
    assert.ok(c.source_context_text.length < input.raw_payload.title.length);
  });
  assert.equal(stableJson(input), before);
});

test('clear separate sale and request sections keep their own intent', () => {
  const r = buildExpandedCandidates(staged('Rolex\nWTB\n116500LN\nWTS\n126610LN asking USD 14000', { is_bundle: 1 }));
  assert.deepEqual(r.candidates.map(c => c.candidate.fields.intent), ['WTB', 'WTS']);
  r.candidates.forEach(c => supported(c.candidate));
});

test('one explicit bundle offer becomes one image-free child without guessing quantity', () => {
  const c = one('WTS Rolex 116500LN', { is_bundle: 1 }); supported(c);
  assert.equal(c.kind, 'CHILD'); assert.equal(c.child_index, 1);
  held(one('WTB Rolex 116500LN 3 pieces'), 'QUANTITY_NOT_INDIVIDUAL_OFFER_IDENTITY');
});

test('package totals and multiple references within a block are held', () => {
  const r = buildExpandedCandidates(staged('Rolex\nWTS\n116500LN\n126610LN\nBoth for USD 35000', { is_bundle: 1 }));
  r.candidates.forEach(c => held(c.candidate, 'PACKAGE_SCOPE_OR_TOTAL_REQUIRES_REVIEW'));
  held(one('WTB Rolex 116500LN or 126610LN'), 'MULTIPLE_REFERENCES_IN_ONE_OFFER_BLOCK');
});

test('multiple currencies are preserved as ambiguous without choosing a preferred quote', () => {
  const c = one('Rolex WTS 116500LN EUR 24000 / HKD 190000'); supported(c);
  assert.equal(c.fields.original_price_amount, null);
  assert.ok(c.decision.price_reasons.includes('MULTIPLE_PRICE_AMBIGUITY'));
});

test('reference inference alone does not manufacture a maker', () => {
  const c = one('WTB 116500LN');
  held(c, 'MANUFACTURER_NOT_ESTABLISHED'); assert.equal(c.fields.brand, null);
});

test('raw maker metadata requires exact catalog corroboration and no contradiction', () => {
  const c = one('WTB 116500LN', { brand: 'Rolex' }); supported(c);
  assert.equal(c.evidence.brand[0].role, 'SOURCE_METADATA_CATALOG_CORROBORATED');
  held(one('WTB Rolex 116500LN', { brand: 'Hublot' }), 'SOURCE_METADATA_MANUFACTURER_CONFLICT');
  held(one('WTB 116500LN', { brand: 'Hublot' }), 'MANUFACTURER_NOT_ESTABLISHED');
});

test('reference is never truncated, suffix invented or sourced from a currency amount', () => {
  assert.equal(one('WTB Rolex 116500 LN').fields.reference, '116500LN');
  const r = buildExpandedCandidates(staged('Rolex WTS HKD328K'));
  assert.equal(r.candidates.length, 0);
  const c = one('WTS Rolex 126755SARU asking $113K'); supported(c);
  assert.equal(c.fields.reference, '126755SARU'); assert.equal(c.fields.original_price_currency, null);
});

test('Unicode normalization retains original codepoint spans and quote hashes', () => {
  const input = staged('😀 Ｗ Ｔ Ｂ Rolex １１６５００LN');
  const c = buildExpandedCandidates(input).candidates[0].candidate; supported(c);
  assert.equal(c.fields.intent, 'WTB'); assert.equal(c.fields.reference, '116500LN');
  const points = Array.from(input.raw_payload.title);
  for (const evidence of [...c.source_spans, ...Object.values(c.evidence).filter(Array.isArray).flat()]) {
    if (evidence.start == null) continue;
    assert.equal(points.slice(evidence.start, evidence.end).join(''), evidence.quote);
    assert.equal(sha(evidence.quote), evidence.quote_sha256);
  }
});

test('source role and child tampering fail deterministic proof verification', () => {
  const input = staged('Rolex\nWTS\n116500LN asking USD 25000', { is_bundle: 1 });
  const entry = buildExpandedCandidates(input).candidates[0];
  entry.candidate.images.image_url = 'parent.jpg';
  assert.throws(() => verifyExpandedCandidate(input, entry), /PROOF_MISMATCH/);
  input.raw_payload.title += ' edited';
  assert.throws(() => buildExpandedCandidates(input), /PROVENANCE_CONTENT_MISMATCH/);
});

test('missing optional model, dial, condition and price do not block a proven watch', () => {
  const c = one('WTB Rolex 116500LN'); supported(c);
  for (const field of ['model', 'dial_color', 'condition', 'year', 'original_price_amount']) assert.equal(c.fields[field], null);
});

test('source status and timestamps are retained without invented sold state or UTC', () => {
  const input = staged('WTB Rolex 116500LN', { status: 'ended', created_on: '2026-09-08 12:34:00' });
  const c = buildExpandedCandidates(input).candidates[0].candidate; supported(c);
  assert.equal(c.fields.source_status, 'ended');
  assert.equal(c.source_dates.created_on, '2026-09-08 12:34:00');
  assert.equal(c.source_date_semantics, 'ORIGINAL_SOURCE_VALUE_TIMEZONE_NOT_ASSUMED');
});

test('reference-compatible accessories do not become watch cards', () => {
  held(one('WTS Rolex dial only 116500LN'), 'NONWATCH_ACCESSORY_OFFER');
});

test('unrecognized following reference is a held block, never attached to a different watch', () => {
  const r = buildExpandedCandidates(staged('Richard Mille\nWTS\nRM30-01 blue HKD3.68m\nRM011ti watch + paper USDT138.5k', { is_bundle: 1 }));
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].candidate.fields.reference, 'RM30-01');
  assert.ok(!r.candidates[0].candidate.source_context_text.includes('RM011'));
  held(r.candidates[1].candidate, 'REFERENCE_FORMAT_UNVERIFIED');
});

test('a supplemental completion or shipping fee cannot replace a missing ask', () => {
  const c = one('Rolex WTS 116681\n19,300 + Label\n+$300 TO MAKE COMPLETE'); supported(c);
  assert.equal(c.fields.original_price_amount, null);
  assert.ok(c.decision.price_reasons.includes('ASKING_PRICE_NOT_ESTABLISHED'));
});

test('price adjustments do not expose the undiscounted amount as the actual ask', () => {
  const c = one('WTS Rolex 116500LN USD 25000-20%'); supported(c);
  assert.equal(c.fields.original_price_amount, null);
  assert.equal(c.fields.original_price_text, 'USD 25000-20%');
  assert.ok(c.decision.price_reasons.includes('PRICE_ADJUSTMENT_REQUIRES_REVIEW'));
});

test('attached dial shorthand is not accepted as a fabricated Rolex suffix', () => {
  const c = one('WTS Rolex 126233vi ix green $144000');
  held(c, 'REFERENCE_FORMAT_UNVERIFIED');
});

test('identical blocks in one parent collapse with every original occurrence span', () => {
  const input = staged('Rolex\nWTS\n116500LN asking USD 25000\n116500LN asking USD 25000', { is_bundle: 1 });
  const r = buildExpandedCandidates(input);
  assert.equal(r.candidates.length, 1); assert.equal(r.identical_blocks_collapsed, 1);
  assert.equal(r.candidates[0].candidate.source_spans.length, 2);
  assert.equal(r.candidates[0].candidate.source_spans[0].quote, r.candidates[0].candidate.source_spans[1].quote);
  assert.ok(verifyExpandedCandidate(input, r.candidates[0]));
});

test('different source prices are separate observations without claiming physical units', () => {
  const r = buildExpandedCandidates(staged('Rolex\nWTS\n116500LN asking USD 25000\n116500LN asking USD 24000\n116500LN asking USD 25000', { is_bundle: 1 }));
  assert.equal(r.candidates.length, 2);
  assert.equal(r.identical_blocks_collapsed, 1);
  assert.deepEqual(r.candidates.map(c => c.candidate.fields.original_price_amount), ['25000', '24000']);
  // A repeated quote in one untimed message is not sufficient A→B→A chronology.
  assert.equal(r.candidates[0].candidate.source_spans.length, 2);
});

test('combined explicit maker/intent/currency header is inherited with source proof', () => {
  const c = one('WTS Rolex USD\n116500LN asking $25000', { is_bundle: 1 }); supported(c);
  assert.equal(c.fields.original_price_currency, 'USD');
  assert.equal(c.fields.brand, 'Rolex');
  assert.equal(c.fields.intent, 'WTS');
});

test('ambiguous section resets earlier currency and intent instead of leaking context', () => {
  const r = buildExpandedCandidates(staged('Rolex\nWTS\nUSD\n116500LN $25000\nWTB/WTS\nUSD/HKD\n126610LN $14000', { is_bundle: 1, type: 'sale' }));
  assert.equal(r.candidates.length, 2);
  held(r.candidates[1].candidate, 'CONFLICTING_SECTION_INTENT');
  assert.equal(r.candidates[1].candidate.fields.intent, null);
  assert.equal(r.candidates[1].candidate.fields.original_price_currency, null);
});
