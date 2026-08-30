'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeCanonicalParentChild,
  computeParentHash,
  computeChildProposalHash
} = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

const BASE_STAGED_ROW = {
  source_id: 'test-uuid-001',
  source_hash: 'hash-abc-001',
  source_system: 'OceanDigital MariaDB',
  source_database: 'thecollective_inventory',
  source_table: 'auctions',
  source_record_id: '1001',
  source_created_on: '2026-03-01T12:00:00.000Z',
  captured_at: '2026-08-30T12:00:00.000Z',
  raw_message: 'FS: Rolex Submariner 116610LN 2020 Excellent USD 12500',
  raw_payload: {
    id: '1001',
    description: 'FS: Rolex Submariner 116610LN 2020 Excellent USD 12500',
    from_name: 'Geneva Dealer',
    from_number: '+41 22 123 4567',
    front_image: 'watches/sub_front.jpg',
    back_image: 'watches/sub_back.jpg'
  }
};

test('1. Single listing normalization produces exactly 1 parent and 1 child with correct identity', () => {
  const result = normalizeCanonicalParentChild(BASE_STAGED_ROW);
  assert.strictEqual(result.parent.child_count, 1);
  assert.strictEqual(result.parent.bundle_structure_type, 'SINGLE');
  assert.strictEqual(result.children.length, 1);

  const child = result.children[0];
  assert.strictEqual(child.child_ordinal, 0);
  assert.strictEqual(child.brand, 'Rolex');
  assert.strictEqual(child.reference, '116610LN');
  assert.strictEqual(child.intent, 'WTS');
  assert.strictEqual(child.price_usd, 12500);
  assert.strictEqual(child.currency_status, 'VERIFIED_EXPLICIT_USD');
  assert.strictEqual(child.trading_floor_eligible, true);
  assert.strictEqual(child.price_research_eligible, true);
  assert.strictEqual(typeof child.child_proposal_hash, 'string');
  assert.strictEqual(child.child_proposal_hash.length, 64);
  assert.strictEqual(child.child_unique_key, `${BASE_STAGED_ROW.source_id}:c:0:${child.child_proposal_hash}`);
});

test('2. Multi-offer bundle listing produces multiple children with individual ordinals and lineages', () => {
  const bundleRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-bundle-002',
    source_hash: 'hash-bundle-002',
    raw_payload: {
      id: '1002',
      description: '1. Rolex 116610LN 2020 USD 12500\n2. Omega Speedmaster 310.30.42.50.01.001 2021 USD 6000\n3. Tudor Black Bay 79230N USD 3200',
      from_name: 'Multi Dealer'
    }
  };

  const result = normalizeCanonicalParentChild(bundleRow);
  assert.strictEqual(result.parent.is_bundle, true);
  assert.strictEqual(result.parent.child_count, 3);
  assert.strictEqual(result.parent.bundle_structure_type, 'MULTI_OFFER_BUNDLE');
  assert.strictEqual(result.children.length, 3);

  // Child 0
  assert.strictEqual(result.children[0].child_ordinal, 0);
  assert.strictEqual(result.children[0].brand, 'Rolex');
  assert.strictEqual(result.children[0].reference, '116610LN');
  assert.strictEqual(result.children[0].price_usd, 12500);

  // Child 1
  assert.strictEqual(result.children[1].child_ordinal, 1);
  assert.strictEqual(result.children[1].brand, 'Omega');
  assert.strictEqual(result.children[1].reference, '310.30.42.50.01.001');
  assert.strictEqual(result.children[1].price_usd, 6000);

  // Child 2
  assert.strictEqual(result.children[2].child_ordinal, 2);
  assert.strictEqual(result.children[2].brand, 'Tudor');
  assert.strictEqual(result.children[2].reference, '79230N');
  assert.strictEqual(result.children[2].price_usd, 3200);

  // Check unique keys
  const keys = new Set(result.children.map(c => c.child_unique_key));
  assert.strictEqual(keys.size, 3);
});

test('3. WTS and WTB listings remain strictly separated in statuses', () => {
  const wtbRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-wtb-003',
    source_hash: 'hash-wtb-003',
    raw_payload: {
      description: 'WTB Rolex Daytona 116500LN paying USD 28000'
    }
  };

  const result = normalizeCanonicalParentChild(wtbRow);
  const child = result.children[0];
  assert.strictEqual(child.intent, 'WTB');
  assert.strictEqual(child.trading_floor_status, 'ELIGIBLE_WTB');
  assert.strictEqual(child.trading_floor_eligible, true);
  assert.strictEqual(child.price_research_status, 'INELIGIBLE_NOT_WTS');
  assert.strictEqual(child.price_research_eligible, false);
});

test('4. Missing price listing is Trading Floor eligible (WTS) but Price Research ineligible', () => {
  const unpricedRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-unpriced-004',
    source_hash: 'hash-unpriced-004',
    raw_payload: {
      description: 'WTS Rolex Submariner 126610LN 2022 full set DM for price'
    }
  };

  const result = normalizeCanonicalParentChild(unpricedRow);
  const child = result.children[0];
  assert.strictEqual(child.intent, 'WTS');
  assert.strictEqual(child.currency_status, 'MISSING_PRICE');
  assert.strictEqual(child.price_usd, null);
  assert.strictEqual(child.trading_floor_eligible, true);
  assert.strictEqual(child.price_research_status, 'INELIGIBLE_MISSING_PRICE');
  assert.strictEqual(child.price_research_eligible, false);
});

test('5. Bare dollar is held as AMBIGUOUS_BARE_DOLLAR_HELD and excluded from Price Research', () => {
  const bareRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-bare-005',
    source_hash: 'hash-bare-005',
    raw_payload: {
      description: 'For sale Rolex 116610LN $ 12500'
    }
  };

  const result = normalizeCanonicalParentChild(bareRow);
  const child = result.children[0];
  assert.strictEqual(child.currency_status, 'AMBIGUOUS_BARE_DOLLAR_HELD');
  assert.strictEqual(child.price_usd, null);
  assert.strictEqual(child.trading_floor_eligible, true);
  assert.strictEqual(child.price_research_status, 'INELIGIBLE_AMBIGUOUS_CURRENCY');
  assert.strictEqual(child.price_research_eligible, false);
});

test('6. Foreign currencies (EUR, HKD, USDT) are preserved and held for FX', () => {
  const eurRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-eur-006',
    source_hash: 'hash-eur-006',
    raw_payload: {
      description: 'WTS Rolex 116610LN EUR 11500'
    }
  };
  const resEur = normalizeCanonicalParentChild(eurRow);
  assert.strictEqual(resEur.children[0].currency_status, 'VERIFIED_EXPLICIT_EUR');
  assert.strictEqual(resEur.children[0].price_usd, null);
  assert.strictEqual(resEur.children[0].price_research_eligible, false);

  const hkdRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-hkd-006',
    source_hash: 'hash-hkd-006',
    raw_payload: {
      description: 'WTS Rolex 116610LN HKD 98000'
    }
  };
  const resHkd = normalizeCanonicalParentChild(hkdRow);
  assert.strictEqual(resHkd.children[0].currency_status, 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX');
  assert.strictEqual(resHkd.children[0].price_usd, null);
  assert.strictEqual(resHkd.children[0].price_research_eligible, false);

  const usdtRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-usdt-006',
    source_hash: 'hash-usdt-006',
    raw_payload: {
      description: 'WTS Rolex 116610LN USDT 12500'
    }
  };
  const resUsdt = normalizeCanonicalParentChild(usdtRow);
  assert.strictEqual(resUsdt.children[0].currency_status, 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX');
  assert.strictEqual(resUsdt.children[0].price_usd, null);
  assert.strictEqual(resUsdt.children[0].price_research_eligible, false);
});

test('7. Price outliers (> $500,000 or < $100) are tagged and excluded from Price Research', () => {
  const highOutlierRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-high-007',
    source_hash: 'hash-high-007',
    raw_payload: {
      description: 'WTS Patek Philippe 5711/1A-010 USD 850000'
    }
  };
  const resHigh = normalizeCanonicalParentChild(highOutlierRow);
  assert.strictEqual(resHigh.children[0].is_outlier, true);
  assert.strictEqual(resHigh.children[0].outlier_reason, 'PRICE_HIGH_OUTLIER');
  assert.strictEqual(resHigh.children[0].price_research_status, 'INELIGIBLE_OUTLIER_EXCLUDED');
  assert.strictEqual(resHigh.children[0].price_research_eligible, false);

  const lowOutlierRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-low-007',
    source_hash: 'hash-low-007',
    raw_payload: {
      description: 'WTS Rolex 116610LN USD 50'
    }
  };
  const resLow = normalizeCanonicalParentChild(lowOutlierRow);
  assert.strictEqual(resLow.children[0].is_outlier, true);
  assert.strictEqual(resLow.children[0].outlier_reason, 'PRICE_LOW_OUTLIER');
  assert.strictEqual(resLow.children[0].price_research_status, 'INELIGIBLE_OUTLIER_EXCLUDED');
  assert.strictEqual(resLow.children[0].price_research_eligible, false);
});

test('8. Multiple images are preserved with ordinals, and image_url is kept null until verified', () => {
  const multiImgRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-img-008',
    source_hash: 'hash-img-008',
    raw_payload: {
      description: 'WTS Rolex 116610LN USD 12500',
      front_image: 'img_front.jpg',
      back_image: 'img_back.jpg',
      gallery_images: ['img_clasp.jpg', 'img_card.jpg']
    }
  };

  const result = normalizeCanonicalParentChild(multiImgRow);
  assert.strictEqual(result.images.length, 4);
  assert.strictEqual(result.images[0].image_ordinal, 0);
  assert.strictEqual(result.images[0].image_key, 'img_front.jpg');
  assert.strictEqual(result.images[0].image_url, null);

  assert.strictEqual(result.images[1].image_ordinal, 1);
  assert.strictEqual(result.images[1].image_key, 'img_back.jpg');

  assert.strictEqual(result.images[2].image_ordinal, 2);
  assert.strictEqual(result.images[2].image_key, 'img_clasp.jpg');

  assert.strictEqual(result.images[3].image_ordinal, 3);
  assert.strictEqual(result.images[3].image_key, 'img_card.jpg');
});

test('9. Missing image yields NO_IMAGE evidence type', () => {
  const noImgRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-noimg-009',
    source_hash: 'hash-noimg-009',
    raw_payload: {
      description: 'WTS Rolex 116610LN USD 12500'
    }
  };

  const result = normalizeCanonicalParentChild(noImgRow);
  assert.strictEqual(result.images.length, 0);
  assert.strictEqual(result.children[0].primary_image_evidence_type, 'NO_IMAGE');
  assert.strictEqual(result.children[0].primary_image_key, null);
  assert.strictEqual(result.children[0].primary_image_url, null);
});

test('10. Hashing is deterministic and captures all attributes', () => {
  const res1 = normalizeCanonicalParentChild(BASE_STAGED_ROW);
  const res2 = normalizeCanonicalParentChild(BASE_STAGED_ROW);

  assert.strictEqual(res1.parent.parent_hash, res2.parent.parent_hash);
  assert.strictEqual(res1.children[0].child_proposal_hash, res2.children[0].child_proposal_hash);
  assert.strictEqual(res1.children[0].child_unique_key, res2.children[0].child_unique_key);
});
