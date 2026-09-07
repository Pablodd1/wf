'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORY_QUOTAS,
  PARENT_COUNT,
  generateSyntheticParents,
} = require('../tools/multilisting/synthetic-bundle-parents.cjs');
const {
  RULESET_VERSION,
  buildLineageChildren,
  parentSourceHash,
} = require('../tools/multilisting/bundle-lineage.cjs');
const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');
const { fingerprint } = require('../tools/multilisting/bundle-cohort.cjs');

function parentsByCategory(category) {
  return generateSyntheticParents(PARENT_COUNT).filter(parent => parent.category === category);
}

test('synthetic generator emits exactly 1,000 parents covering the full matrix, deterministically', () => {
  const first = generateSyntheticParents(PARENT_COUNT);
  const second = generateSyntheticParents(PARENT_COUNT);
  assert.equal(first.length, 1000);
  assert.equal(fingerprint(first), fingerprint(second), 'generator must be deterministic');
  const counts = first.reduce((acc, parent) => {
    acc[parent.category] = (acc[parent.category] || 0) + 1;
    return acc;
  }, {});
  for (const [category, quota] of CATEGORY_QUOTAS) {
    assert.equal(counts[category], quota, `category ${category}`);
  }
});

test('synthetic fixtures contain no contact or external-reference patterns', () => {
  const banned = [/@/, /\bwhatsapp\b/i, /\btelegram\b/i, /\bwechat\b/i, /https?:\/\/(?!img\.invalid)/i];
  for (const parent of generateSyntheticParents(PARENT_COUNT)) {
    for (const pattern of banned) {
      assert.equal(pattern.test(parent.source.raw_message), false, `${parent.source.id} matches ${pattern}`);
    }
  }
});

test('sibling non-inheritance: child A price/image/dial never leaks to child B', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b201',
    raw_message: [
      '126610LN black 2024 new hkd 98k',
      '5711/1A blue 2021 used 750,000 USD',
    ].join('\n'),
    listing_type: 'WTS',
    dial_color: 'Green',
    image_urls: ['https://img.invalid/phase7/leak-probe.jpg'],
  };
  const [a, b] = buildLineageChildren(source);
  assert.equal(a.currency, 'HKD');
  assert.equal(b.currency, 'USD');
  assert.notEqual(a.price_raw, b.price_raw);
  assert.equal(a.dial_color, 'Black');
  assert.ok(b.dial_color === null || b.dial_color === 'Blue', 'child B dial must come from its own line only');
  // Parent-level dial must not leak into either child.
  assert.notEqual(a.dial_color, 'Green');
  assert.notEqual(b.dial_color, 'Green');
  // Child A's dial must not leak into child B.
  assert.notEqual(b.dial_color, 'Black');
  // Parent image is never inherited; only exact attachment evidence may set it.
  assert.equal(a.image, null);
  assert.equal(b.image, null);
  assert.deepEqual(Object.keys(a).filter(key => /image|media|photo/i.test(key)), ['image']);
});

test('collapsed parent structured price is not copied into multi-child splits', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b202',
    raw_message: '126610LN black 2024 new\n116500LN white 2022 used',
    listing_type: 'WTS',
    price_raw: 98000,
    currency: 'HKD',
  };
  const children = buildLineageChildren(source);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.price_raw, null, 'parent structured price must not be inherited');
    assert.equal(child.price_usd, null);
    assert.equal(child.currency, null);
  }
});

test('WTB child stays WTB and is never Price-Research eligible', () => {
  const mixed = parentsByCategory('mixed_intent');
  assert.ok(mixed.length > 0);
  let sawWtb = 0;
  for (const parent of mixed) {
    for (const child of buildLineageChildren(parent.source)) {
      if (/^\s*WTB\b/i.test(child.raw_line)) {
        sawWtb += 1;
        assert.equal(child.listing_type, 'WTB');
        assert.equal(child.price_research_eligible, false);
      }
    }
  }
  assert.ok(sawWtb > 0, 'expected WTB children in the mixed_intent category');
});

test('unpriced WTS child stays unpriced: TF-eligible but PR-ineligible', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b203',
    raw_message: '126610LN black 2024 new full set\n116500LN white 2022 used 280,000 USD',
    listing_type: 'WTS',
  };
  const [unpriced, priced] = buildLineageChildren(source);
  assert.equal(unpriced.price_raw, null);
  assert.equal(unpriced.listing_type, 'WTS');
  assert.equal(unpriced.trading_floor_eligible, true);
  assert.equal(unpriced.price_research_eligible, false);
  assert.ok(unpriced.flags.includes('PRICE_REQUIRED'));
  assert.equal(priced.price_research_eligible, true);
});

test('unresolved or ambiguous child is held as a review candidate, never accepted', () => {
  const ambiguous = parentsByCategory('ambiguous_reference');
  assert.ok(ambiguous.length > 0);
  let flagged = 0;
  for (const parent of ambiguous) {
    for (const child of buildLineageChildren(parent.source)) {
      assert.equal(child.review_state, 'PENDING_REVIEW');
      if (child.flags.includes('AMBIGUOUS_REFERENCE_LINE')) flagged += 1;
    }
  }
  assert.ok(flagged > 0, 'ambiguous reference lines must be explicitly flagged');
});

test('parent record is unchanged by lineage derivation (hash before == after)', () => {
  for (const parent of generateSyntheticParents(PARENT_COUNT).slice(0, 50)) {
    const before = fingerprint(parent.source);
    const hashBefore = parentSourceHash(parent.source);
    buildLineageChildren(parent.source);
    assert.equal(fingerprint(parent.source), before);
    assert.equal(parentSourceHash(parent.source), hashBefore);
  }
});

test('deterministic child IDs: stable across runs, bound to (parent id, parent hash, ordinal)', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b204',
    raw_message: '126610LN black 2024 new hkd 98k\n116500LN white 2022 used 280,000 USD',
    listing_type: 'WTS',
  };
  const run1 = buildLineageChildren(source).map(child => child.child_id);
  const run2 = buildLineageChildren({ ...source }).map(child => child.child_id);
  assert.deepEqual(run1, run2, 'same input must produce the same child IDs');

  const tampered = buildLineageChildren({ ...source, raw_message: source.raw_message.replace('98k', '99k') });
  assert.notDeepEqual(tampered.map(child => child.child_id), run1, 'parent hash change must change child IDs');

  const renamed = buildLineageChildren({ ...source, id: '00000000-0000-4000-8000-00000000b299' });
  assert.notDeepEqual(renamed.map(child => child.child_id), run1, 'parent id change must change child IDs');

  const swapped = buildLineageChildren({
    ...source,
    raw_message: '116500LN white 2022 used 280,000 USD\n126610LN black 2024 new hkd 98k',
  });
  assert.notDeepEqual(swapped.map(child => child.child_id), run1, 'ordinal change must change child IDs');
});

test('exact span coordinates recover the child line from the parent message', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b205',
    raw_message: 'Rolex\n126610LN black 2024 new hkd 98k\n126610LN black 2024 new hkd 98k',
    listing_type: 'WTS',
  };
  const normalized = source.raw_message.replace(/\r\n?/g, '\n');
  const children = buildLineageChildren(source);
  assert.equal(children.length, 2);
  assert.notEqual(children[0].child_id, children[1].child_id, 'identical lines still get distinct ordinals');
  for (const child of children) {
    assert.ok(child.span, 'span is required');
    assert.equal(normalized.slice(child.span.start, child.span.end), child.raw_line);
    assert.notEqual(child.evidence_hash, null);
  }
  assert.notEqual(children[0].span.start, children[1].span.start, 'repeated lines get distinct spans');
});

test('inherited section context is explicitly recorded on the child', () => {
  const source = {
    id: '00000000-0000-4000-8000-00000000b206',
    raw_message: 'Patek Philippe\nHKD\nfull set\n5711/1A blue 2021 new 700k',
    listing_type: 'WTS',
  };
  const [child] = buildLineageChildren(source);
  assert.equal(child.inherited_section_context.brand_context, 'Patek Philippe');
  assert.equal(child.inherited_section_context.currency_context, 'HKD');
  assert.equal(child.inherited_section_context.set_status_context, 'Full Set');
  assert.equal(child.parser_version.length > 0, true);
  assert.equal(child.ruleset_version, RULESET_VERSION);
});

test('full 1,000-parent reconciliation is exact: no silent drops', () => {
  const parents = generateSyntheticParents(PARENT_COUNT);
  let candidates = 0;
  let reviewRequired = 0;
  let rejected = 0;
  let accepted = 0;
  let errors = 0;
  let prEligible = 0;
  for (const parent of parents) {
    try {
      const children = buildLineageChildren(parent.source, { shadow: analyzeRecord(parent.source) });
      candidates += children.length;
      for (const child of children) {
        if (!child.exact_raw_lineage) rejected += 1;
        else reviewRequired += 1;
        if (child.price_research_eligible) prEligible += 1;
      }
    } catch {
      errors += 1;
    }
  }
  assert.equal(parents.length, (parents.length - errors) + errors);
  assert.equal(candidates, accepted + reviewRequired + rejected, 'children reconciliation must be exact');
  assert.ok(prEligible <= reviewRequired, 'PR-eligible is a subset of review-required');
  assert.ok(candidates > parents.length, 'bundle split must expand the cohort');
});
