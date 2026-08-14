'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bundleCandidateCount,
  deterministicCandidateCount,
  loadShadowBundleParentIds,
  multiItemRisk,
} = require('../api/_lib/unsplit-bundle-filter.cjs');

test('detects stored flags and raw multi-reference messages', () => {
  assert.equal(deterministicCandidateCount({ flags: ['BUNDLE_SPLIT_REQUIRED'], raw_message: '5712/1A' }), 2);
  assert.ok(deterministicCandidateCount({ raw_message: '5712/1A Blue\n116500LN White' }) > 1);
});

test('quarantines the live RM three-watch message and reference-list requests', () => {
  const priced = multiItemRisk('-RM002-V2 usdt 440.000  RM014 usdtt 458.000  RM022 usd 665.000');
  assert.equal(priced.is_multi, true);
  assert.deepEqual(priced.references, ['RM002-V2', 'RM014', 'RM022']);

  for (const raw of [
    'Looking for rm001, rm002,rm003',
    'WTB RM002 / RM003',
    'NTQ RM001 or RM002 white gold only',
  ]) {
    const risk = multiItemRisk(raw);
    assert.equal(risk.is_multi, true, raw);
    assert.ok(risk.references.length >= 2, raw);
  }
});

test('quarantines same-line cross-brand and quantity bundles without numeric false positives', () => {
  assert.equal(multiItemRisk('Rolex 126610LN USD 14k, Patek 5712/1A USD 100k').is_multi, true);
  assert.equal(multiItemRisk('Rolex Submariner x 2 full sets').is_multi, true);
  assert.equal(multiItemRisk('Rolex 126500LN 2025 full set USD 30k phone 17869569201').is_multi, false);
  assert.equal(multiItemRisk('Patek 5712/1A HKD 900k / USD 115k').is_multi, false);
});

test('shadow evidence overrides a parser miss', () => {
  assert.equal(bundleCandidateCount({ id: 'parent', raw_message: 'Dealer stock list' }, new Set(['parent'])), 2);
});

test('loads shadow-confirmed parent ids through the service RPC', async () => {
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'unsplit_bundle_parent_ids');
      assert.deepEqual(args.p_source_record_ids, ['a', 'b']);
      return { data: [{ source_record_id: 'b' }], error: null };
    },
  };
  assert.deepEqual(await loadShadowBundleParentIds(client, [{ id: 'a' }, { id: 'b' }]), new Set(['b']));
});
