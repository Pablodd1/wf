'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const intake = require('../tools/intake/prepare-franck-muller-admission.cjs');

function source(overrides = {}) {
  return {
    listing_id: 'wf-fm-001', source_message_id: 'message-001', raw_message: 'Franck Muller 8880 WTS $12,000',
    source_posted_at: '2026-08-16T12:00:00Z', seller_source_id: 'seller-001', seller_name_source: 'Seller',
    source_brand_text: 'Franck Muller', intent: 'WTS', category: 'WATCH', source_currency: 'USD',
    normalized_price_usd: 12000, fx_source: 'SOURCE_EXPLICIT_USD', fx_rate_date: '2026-08-16', image_count_source: 1,
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    final_brand: 'Franck Muller', final_model: 'Vanguard', final_reference: 'V45', dial_normalized: 'Black', identity_status: 'VERIFIED',
    bundle_status: 'SINGLE_CANDIDATE', image_status: 'VERIFIED', duplicate_decision: 'COUNT',
    trading_floor_status: 'PUBLISH', price_research_status: 'ELIGIBLE', ...overrides,
  };
}

test('Franck Muller intake accepts only a fully verified single-watch admission', () => {
  const result = intake.classifyRow(source(), decision());
  assert.equal(result.trading_floor_candidate, true);
  assert.equal(result.price_research_candidate, true);
  assert.equal(result.disposition, 'REVIEW_REQUIRED');
});

test('Franck Muller intake holds a publish-marked row whose identity remains under review', () => {
  const result = intake.classifyRow(source(), decision({ identity_status: 'REVIEW_REQUIRED' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.equal(result.disposition, 'HOLD_FOR_REVIEW');
  assert.match(result.reasons.join('|'), /IDENTITY_REVIEW_REQUIRED/);
});

test('Franck Muller intake never treats a currency token as a reference', () => {
  const result = intake.classifyRow(source(), decision({ final_reference: '18500HKD' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.match(result.reasons.join('|'), /REFERENCE_UNRESOLVED_OR_PRICE_TOKEN/);
});

test('Franck Muller intake holds foreign brand rows even if the decision ledger says publish', () => {
  const result = intake.classifyRow(source({ source_brand_text: 'Rolex' }), decision({ final_brand: 'Rolex' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.match(result.reasons.join('|'), /BRAND_SCOPE_MISMATCH/);
});

test('shared admission contract accepts another explicitly selected brand only', () => {
  const tagDecision = decision({ final_brand: 'TAG Heuer', final_model: 'Carrera', final_reference: 'CBL2111' });
  const accepted = intake.classifyRow(source({ source_brand_text: 'TAG Heuer' }), tagDecision, 'TAG Heuer');
  const rejected = intake.classifyRow(source({ source_brand_text: 'TAG Heuer' }), tagDecision, 'Breguet');
  assert.equal(accepted.trading_floor_candidate, true);
  assert.equal(rejected.trading_floor_candidate, false);
  assert.match(rejected.reasons.join('|'), /BRAND_SCOPE_MISMATCH/);
});

test('admission intent recognizes sell-side dealer tokens and explicit USD policy', () => {
  for (const token of ['WTS', 'LTS', 'LQT', 'LTQ', 'FS', 'for sale', 'available']) {
    const evidence = intake.admissionIntent(`Franck Muller V45 ${token} USD 12000`, 'OTHER');
    assert.equal(evidence.intent, 'WTS', token);
    assert.equal(evidence.raw_sell_side, true, token);
  }
  const explicitUsd = intake.admissionIntent('Franck Muller V45 USD 12000', 'OTHER');
  assert.equal(explicitUsd.intent, 'WTS');
  assert.equal(explicitUsd.raw_sell_side, true);
  assert.equal(explicitUsd.basis, 'RAW_EXPLICIT_USD_PRICE');
  const explicitUsSymbol = intake.admissionIntent('Franck Muller V45 US$ 12000', 'OTHER');
  assert.equal(explicitUsSymbol.intent, 'WTS');
  assert.equal(explicitUsSymbol.basis, 'RAW_EXPLICIT_USD_PRICE');
});

test('raw buy-side language remains WTB even when a budget and stale WTS intent exist', () => {
  for (const raw of [
    'WTB Franck Muller V45 budget USD 12000',
    'Need Franck Muller V45 budget USD 12000',
    'Looking for Franck Muller V45, can pay USD 12000',
  ]) {
    const evidence = intake.admissionIntent(raw, 'WTS');
    assert.equal(evidence.intent, 'WTB', raw);
    assert.equal(evidence.raw_buy_side, true, raw);
    const result = intake.classifyRow(source({ raw_message: raw, intent: 'WTS' }), decision());
    assert.equal(result.trading_floor_candidate, true);
    assert.equal(result.resolved_intent, 'WTB');
    assert.equal(result.price_research_candidate, false);
    assert.ok(result.reasons.includes('WTB_DEMAND_EXCLUDED_FROM_WTS_ANALYTICS'));
  }
});

test('structured buy intent wins over an otherwise sell-implying explicit USD amount', () => {
  for (const structured of ['WTB', 'NTQ', 'LTB', 'ISO', 'LOOKING', 'NEED']) {
    const evidence = intake.admissionIntent('Franck Muller V45 USD 12000', structured);
    assert.equal(evidence.intent, 'WTB', structured);
    assert.equal(evidence.basis, 'SOURCE_BUY_INTENT', structured);
    const result = intake.classifyRow(
      source({ raw_message: 'Franck Muller V45 USD 12000', intent: structured }),
      decision(),
    );
    assert.equal(result.resolved_intent, 'WTB', structured);
    assert.equal(result.price_research_candidate, false, structured);
  }
});

test('an explicit USD amount in the child raw segment implies WTS when buy intent is absent', () => {
  const result = intake.classifyRow(
    source({ raw_message: 'Franck Muller V45 USD 12000', intent: 'WTS' }),
    decision(),
  );
  assert.equal(result.trading_floor_candidate, true);
  assert.equal(result.resolved_intent, 'WTS');
  assert.equal(result.intent_basis, 'RAW_EXPLICIT_USD_PRICE');
  assert.equal(result.price_research_candidate, true);
  assert.equal(result.reasons.includes('RAW_SELL_SIDE_LANGUAGE_MISSING'), false);
});

test('bare dollar remains ambiguous and cannot imply WTS Price Research intent', () => {
  const evidence = intake.admissionIntent('Franck Muller V45 $12000', 'WTS');
  assert.equal(evidence.intent, 'WTS');
  assert.equal(evidence.raw_sell_side, false);
  assert.equal(evidence.basis, 'SOURCE_INTENT');
  const result = intake.classifyRow(
    source({ raw_message: 'Franck Muller V45 $12000', intent: 'WTS' }),
    decision(),
  );
  assert.equal(result.trading_floor_candidate, true);
  assert.equal(result.price_research_candidate, false);
  assert.ok(result.reasons.includes('RAW_SELL_SIDE_LANGUAGE_MISSING'));
});

test('retail, list-price, appraisal, and MSRP context cannot imply WTS', () => {
  for (const raw of [
    'Franck Muller V45 retail price USD 12000',
    'Franck Muller V45 list price 12000 USD',
    'Franck Muller V45 appraisal USD 12000',
    'Franck Muller V45 MSRP USD 12000',
  ]) {
    const evidence = intake.admissionIntent(raw, 'OTHER');
    assert.equal(evidence.intent, 'OTHER', raw);
    assert.equal(evidence.raw_sell_side, false, raw);
    const result = intake.classifyRow(source({ raw_message: raw, intent: 'OTHER' }), decision());
    assert.equal(result.price_research_candidate, false, raw);
  }
});
