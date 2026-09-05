'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const control = require('../tools/intake/apply-reviewed-workbook-integrity-canary.cjs');

const hash = 'a'.repeat(64);
const runSha = '1'.repeat(40);
const identityControl = {
  action: 'QUARANTINE_IDENTITY_CONFLICT',
  expected_status: 'APPROVED_SINGLE_CANDIDATE',
  new_status: 'QUARANTINED_IDENTITY_CONFLICT',
  also_hold_price: false,
  canary_category: 'RAW_BRAND_CONFLICT',
  canary_priority: 2,
};
const residualControl = {
  ...identityControl,
  action: 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT',
  canary_category: 'RESIDUAL_CATALOG_CONFLICT',
  canary_priority: 3,
};
const priceControl = {
  action: 'HOLD_CURRENCY_CONFLICT_PRICE',
  expected_status: 'SOURCE_EXPLICIT_USD_MATCH',
  new_status: 'PRICE_EVIDENCE_INCOMPLETE',
  canary_category: 'THREE_BRAND_CURRENCY_REGRESSION',
  canary_priority: 1,
};
const legacyControl = target => ({
  action: 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE',
  expected_status: 'SOURCE_EXPLICIT_USD_MATCH',
  new_status: target || '',
  canary_category: target === 'PRICE_NOT_SUPPLIED' ? 'LEGACY_PRICE_NULL' : 'LEGACY_PRICE_RETAIN',
  canary_priority: target === 'PRICE_NOT_SUPPLIED' ? 1 : 2,
});

test('builds exact hash-guarded derived-field-only actions', () => {
  const plan = control.buildPlan({
    identityRows: [{ listing_id: 'id-a', source_payload_sha256: hash, ...identityControl, conflict_reasons: 'CATALOG_BRAND_SCOPE_CONFLICT' }],
    priceRows: [{ listing_id: 'id-b', source_payload_sha256: hash, ...priceControl }],
  });
  assert.deepEqual(plan[0].patch, { verification_status: 'QUARANTINED_IDENTITY_CONFLICT' });
  assert.deepEqual(plan[1].patch, { price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null });
  assert.ok(plan.every(action => !Object.hasOwn(action.patch, 'raw_message')));
});

test('rejects overlapping manifests and non-sha guards', () => {
  assert.throws(() => control.buildPlan({ identityRows: [{ listing_id: 'x', source_payload_sha256: 'bad', ...identityControl }] }), /sha256/);
  assert.throws(() => control.buildPlan({
    identityRows: [{ listing_id: 'x', source_payload_sha256: hash, ...identityControl }],
    priceRows: [{ listing_id: 'x', source_payload_sha256: hash, ...priceControl }],
  }), /overlapping/);
  assert.throws(() => control.buildPlan({
    priceRows: [{ listing_id: 'x', source_payload_sha256: hash, ...priceControl }],
    driftPriceRows: [{ listing_id: 'x', source_payload_sha256: hash, ...legacyControl() }],
  }), /overlapping/);
});

test('rejects manifests whose declared action or status does not match the runner', () => {
  assert.throws(() => control.buildPlan({ identityRows: [{
    listing_id: 'x', source_payload_sha256: hash, ...identityControl,
    new_status: 'APPROVED_SINGLE_CANDIDATE',
  }] }), /manifest control fields/);
});

test('dual identity conflicts quarantine identity and remove the invalid qualified price', () => {
  const plan = control.buildPlan({ identityRows: [{
    listing_id: 'dual', source_payload_sha256: hash, ...identityControl,
    also_hold_price: true, expected_price_status: 'SOURCE_EXPLICIT_USD_MATCH',
    new_price_status: 'PRICE_EVIDENCE_INCOMPLETE', canary_category: 'DUAL_IDENTITY_PRICE',
    canary_priority: 1,
  }] });
  assert.deepEqual(plan[0].expected, {
    verification_status: 'APPROVED_SINGLE_CANDIDATE',
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
  });
  assert.deepEqual(plan[0].patch, {
    verification_status: 'QUARANTINED_IDENTITY_CONFLICT',
    price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null,
  });
});

test('residual identity controls remain a distinct hash-guarded action', () => {
  const plan = control.buildPlan({ residualIdentityRows: [{
    listing_id: 'residual', source_payload_sha256: hash, ...residualControl,
    also_hold_price: true, expected_price_status: 'SOURCE_EXPLICIT_USD_MATCH',
    new_price_status: 'PRICE_EVIDENCE_INCOMPLETE',
  }] });
  assert.equal(plan[0].action, 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT');
  assert.deepEqual(plan[0].patch, {
    verification_status: 'QUARANTINED_IDENTITY_CONFLICT',
    price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null,
  });
});

test('residual identity safely absorbs an exact prior price hold for the same row', () => {
  const plan = control.buildPlan({
    residualIdentityRows: [{
      listing_id: 'merged', source_payload_sha256: hash, ...residualControl,
      also_hold_price: true, expected_price_status: 'SOURCE_EXPLICIT_USD_MATCH',
      new_price_status: 'PRICE_EVIDENCE_INCOMPLETE',
    }],
    priceRows: [{ listing_id: 'merged', source_payload_sha256: hash, ...priceControl }],
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT');
  assert.throws(() => control.buildPlan({
    residualIdentityRows: [{
      listing_id: 'merged', source_payload_sha256: hash, ...residualControl,
      also_hold_price: false,
    }],
    priceRows: [{ listing_id: 'merged', source_payload_sha256: hash, ...priceControl }],
  }), /not an exact controlled merge/);
});

test('legacy drift rows use the same exact guarded price hold without importing rows', () => {
  const plan = control.buildPlan({ driftPriceRows: [{
    listing_id: 'legacy-a', source_payload_sha256: hash, drift_reason: 'STRICT_RULE_DRIFT',
    ...legacyControl(),
  }] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE');
  assert.equal(plan[0].evidence_reason, 'STRICT_RULE_DRIFT');
  assert.deepEqual(plan[0].patch, {
    price_evidence_status: 'PRICE_EVIDENCE_INCOMPLETE', workbook_price_usd: null,
  });
});

test('legacy drift target controls whether the existing price is retained or nulled', () => {
  const plan = control.buildPlan({ driftPriceRows: [{
    listing_id: 'legacy-retain', source_payload_sha256: hash,
    target_price_evidence_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE', null_price: false,
    ...legacyControl('PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE'),
  }, {
    listing_id: 'legacy-null', source_payload_sha256: hash,
    target_price_evidence_status: 'PRICE_NOT_SUPPLIED', null_price: true,
    ...legacyControl('PRICE_NOT_SUPPLIED'),
  }] });
  assert.deepEqual(plan[0].patch, {
    price_evidence_status: 'PRICE_NOT_SUPPLIED', workbook_price_usd: null,
  });
  assert.deepEqual(plan[1].patch, {
    price_evidence_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
  });
  assert.ok(plan.every(action => !Object.hasOwn(action.patch, 'raw_message')));
});

test('legacy drift rows reject unsafe targets and ambiguous null flags', () => {
  assert.throws(() => control.buildPlan({ driftPriceRows: [{
    listing_id: 'legacy-a', source_payload_sha256: hash,
    target_price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', null_price: false,
    ...legacyControl('SOURCE_EXPLICIT_USD_MATCH'),
  }] }), /unsupported target/);
  assert.throws(() => control.buildPlan({ driftPriceRows: [{
    listing_id: 'legacy-b', source_payload_sha256: hash,
    target_price_evidence_status: 'PRICE_NOT_SUPPLIED', null_price: 'maybe',
    ...legacyControl('PRICE_NOT_SUPPLIED'),
  }] }), /true or false/);
});

test('canary is limited to ten exact rows and QNSA is pinned', () => {
  const plan = Array.from({ length: 11 }, (_, index) => ({ action: 'QUARANTINE_IDENTITY_CONFLICT', id: String(index) }));
  assert.throws(() => control.validateMode({ mode: 'canary', confirm: 'APPLY_QNSA_REVIEWED_WORKBOOK_CANARY', runSha }, plan), /1\.\.10/);
  assert.doesNotThrow(() => control.assertQnsa('https://qnsafosakvonzgfcsphh.supabase.co', control.PROJECT_REF));
  assert.throws(() => control.assertQnsa('https://example.supabase.co', control.PROJECT_REF), /not canonical QNSA/);
});

test('full mode requires a canary report bound to the same full plan hash', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-canary-')), 'report.json');
  fs.writeFileSync(file, JSON.stringify({
    mode: 'canary', status: 'COMPLETE', failed_rows: 0, reconciled_rows: 2,
    requested_rows: 2, project_ref: control.PROJECT_REF, full_plan_sha256: 'b'.repeat(64),
    control_plan_sha256: 'c'.repeat(64), run_sha: runSha,
  }));
  assert.doesNotThrow(() => control.validateMode({
    mode: 'full', confirm: 'APPLY_QNSA_REVIEWED_WORKBOOK_FULL_AFTER_CANARY', canaryReport: file, runSha,
  }, [], 'b'.repeat(64)));
  assert.throws(() => control.validateMode({
    mode: 'full', confirm: 'APPLY_QNSA_REVIEWED_WORKBOOK_FULL_AFTER_CANARY', canaryReport: file, runSha,
  }, [], 'd'.repeat(64)), /not complete and reconciled/);
});

test('canary selection is bounded independently by action type', () => {
  const plan = [
    { action: 'QUARANTINE_IDENTITY_CONFLICT', id: 'a', canary_priority: 2 },
    { action: 'QUARANTINE_IDENTITY_CONFLICT', id: 'b', canary_priority: 1 },
    { action: 'HOLD_CURRENCY_CONFLICT_PRICE', id: 'c', canary_priority: 1 },
    { action: 'RECONCILE_LEGACY_LEDGER_PRICE_EVIDENCE', id: 'd', canary_priority: 1 },
    { action: 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT', id: 'e', canary_priority: 3, canary_category: 'RESIDUAL_CATALOG_CONFLICT' },
    { action: 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT', id: 'f', canary_priority: 1, canary_category: 'RESIDUAL_TAG_RM_DUAL' },
    { action: 'QUARANTINE_RESIDUAL_IDENTITY_CONFLICT', id: 'g', canary_priority: 2, canary_category: 'RESIDUAL_BREGUET_JLC_DUAL' },
  ];
  const selected = control.selectActions(plan, {
    mode: 'canary', maxIdentity: 1, maxPrice: 1, maxLegacy: 1, maxResidual: 3,
  });
  assert.deepEqual(selected.map(item => item.id), ['b', 'c', 'd', 'e', 'f', 'g']);
});

test('full plan is one atomic transaction with count and immutable-row guards', () => {
  const sql = control.atomicFullSql(control.buildPlan({
    identityRows: [{ listing_id: 'id-a', source_payload_sha256: hash, ...identityControl }],
    priceRows: [{ listing_id: 'id-b', source_payload_sha256: hash, ...priceControl }],
  }));
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /exact id\/hash match count/);
  assert.match(sql, /immutable source-row hash changed/);
  assert.match(sql, /post-update reconciliation count/);
  assert.match(sql, /QUARANTINE_RESIDUAL_IDENTITY_CONFLICT/);
  assert.doesNotMatch(sql, /p\.null_price/);
  assert.doesNotMatch(sql, /DELETE|TRUNCATE|raw_message\s*=/i);
});

test('exact raw USD promotions are hash guarded and set only the reviewed price fields', () => {
  const plan = control.buildPlan({ promotionRows: [{
    listing_id: 'promotion-a', source_payload_sha256: hash,
    action: 'PROMOTE_EXACT_RAW_USD_PRICE',
    expected_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
    new_status: 'SOURCE_EXPLICIT_USD_MATCH', proposed_price_usd: '12500',
    source_currency: 'USDT', canary_category: 'EXACT_USD', canary_priority: 1,
  }] });
  assert.deepEqual(plan[0].expected, {
    verification_status: 'APPROVED_SINGLE_CANDIDATE',
    price_evidence_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
  });
  assert.deepEqual(plan[0].patch, {
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: 12500,
  });
  assert.match(control.atomicFullSql(plan), /new_price numeric/);
  assert.throws(() => control.buildPlan({ promotionRows: [{
    listing_id: 'bad', source_payload_sha256: hash,
    action: 'PROMOTE_EXACT_RAW_USD_PRICE', expected_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
    new_status: 'SOURCE_EXPLICIT_USD_MATCH', proposed_price_usd: 500, source_currency: 'USD',
    canary_category: 'BAD', canary_priority: 1,
  }] }), /invalid/);
});
