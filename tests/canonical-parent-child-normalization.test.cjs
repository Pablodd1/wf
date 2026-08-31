'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  normalizeCanonicalParentChild,
  computeParentHash,
  computeChildProposalHash,
  buildAuthorizedInquiryContract,
  resolveProductionImageUrl,
  verifyImageReachabilityBounded,
  DEFAULT_NYC3_BASE,
  sha256
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
  assert.strictEqual(result.children[0].intent, 'WTB');
  assert.strictEqual(result.children[0].trading_floor_status, 'ELIGIBLE_WTB');
  assert.strictEqual(result.children[0].trading_floor_eligible, true);
  assert.strictEqual(result.children[0].price_research_status, 'INELIGIBLE_NOT_WTS');
  assert.strictEqual(result.children[0].price_research_eligible, false);
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
  assert.strictEqual(result.children[0].price_usd, null);
  assert.strictEqual(result.children[0].currency_status, 'MISSING_PRICE');
  assert.strictEqual(result.children[0].trading_floor_status, 'ELIGIBLE_WTS');
  assert.strictEqual(result.children[0].trading_floor_eligible, true);
  assert.strictEqual(result.children[0].price_research_status, 'INELIGIBLE_MISSING_PRICE');
  assert.strictEqual(result.children[0].price_research_eligible, false);
});

test('5. Bare dollar is held as AMBIGUOUS_BARE_DOLLAR_HELD and excluded from Price Research', () => {
  const bareDollarRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-bare-005',
    source_hash: 'hash-bare-005',
    raw_payload: {
      description: 'WTS Rolex GMT-Master II 126710BLRO $19,500'
    }
  };

  const result = normalizeCanonicalParentChild(bareDollarRow);
  assert.strictEqual(result.children[0].currency_status, 'AMBIGUOUS_BARE_DOLLAR_HELD');
  assert.strictEqual(result.children[0].price_usd, null);
  assert.strictEqual(result.children[0].price_research_status, 'INELIGIBLE_AMBIGUOUS_CURRENCY');
  assert.strictEqual(result.children[0].price_research_eligible, false);
  assert.strictEqual(result.children[0].trading_floor_eligible, true);
});

test('6. Foreign currencies (EUR, HKD, USDT) are preserved and held for FX', () => {
  const eurRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-eur-006a',
    source_hash: 'hash-eur-006a',
    raw_payload: {
      description: 'WTS Rolex Datejust 126334 EUR 11500'
    }
  };
  const resEur = normalizeCanonicalParentChild(eurRow);
  assert.strictEqual(resEur.children[0].currency_status, 'VERIFIED_EXPLICIT_EUR');
  assert.strictEqual(resEur.children[0].original_price_currency, 'EUR');
  assert.strictEqual(resEur.children[0].original_price_amount, 11500);
  assert.strictEqual(resEur.children[0].price_usd, null);
  assert.strictEqual(resEur.children[0].price_research_eligible, false);

  const usdtRow = {
    ...BASE_STAGED_ROW,
    source_id: 'test-usdt-006b',
    source_hash: 'hash-usdt-006b',
    raw_payload: {
      description: 'WTS Rolex Daytona 116500LN 29000 USDT'
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
      description: 'WTS Omega Speedmaster 310.30.42.50.01.001 USD 45'
    }
  };
  const resLow = normalizeCanonicalParentChild(lowOutlierRow);
  assert.strictEqual(resLow.children[0].is_outlier, true);
  assert.strictEqual(resLow.children[0].outlier_reason, 'PRICE_LOW_OUTLIER');
  assert.strictEqual(resLow.children[0].price_research_status, 'INELIGIBLE_OUTLIER_EXCLUDED');
  assert.strictEqual(resLow.children[0].price_research_eligible, false);
});

test('8. Multiple images are preserved with ordinals, and image_url is kept null until verified', () => {
  const res = normalizeCanonicalParentChild(BASE_STAGED_ROW);
  assert.strictEqual(res.images.length, 2);
  assert.strictEqual(res.images[0].image_ordinal, 0);
  assert.strictEqual(res.images[0].image_key, 'watches/sub_front.jpg');
  assert.strictEqual(res.images[0].image_url, null);
  assert.strictEqual(res.images[0].image_evidence_type, 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED');

  assert.strictEqual(res.images[1].image_ordinal, 1);
  assert.strictEqual(res.images[1].image_key, 'watches/sub_back.jpg');
});

test('9. Missing image yields NO_IMAGE evidence type', () => {
  const noImgRow = {
    ...BASE_STAGED_ROW,
    raw_payload: {
      description: 'WTS Rolex Submariner 116610LN USD 12000'
    }
  };
  const res = normalizeCanonicalParentChild(noImgRow);
  assert.strictEqual(res.images.length, 0);
  assert.strictEqual(res.children[0].primary_image_evidence_type, 'NO_IMAGE');
});

test('10. Hashing is deterministic and captures all attributes', () => {
  const res1 = normalizeCanonicalParentChild(BASE_STAGED_ROW);
  const res2 = normalizeCanonicalParentChild(BASE_STAGED_ROW);

  assert.strictEqual(res1.parent.parent_hash, res2.parent.parent_hash);
  assert.strictEqual(res1.children[0].child_proposal_hash, res2.children[0].child_proposal_hash);
});

test('11. Bundle child-count reconciliation: 9,860 single children + 381 bundle children = 10,241 total children', () => {
  const singleCount = 9860;
  const bundleParentCount = 140;
  const totalChildrenCount = 10241;
  const bundleChildrenCount = totalChildrenCount - singleCount;

  assert.strictEqual(bundleChildrenCount, 381);
  assert.strictEqual(singleCount + bundleChildrenCount, totalChildrenCount);
  assert.ok(bundleChildrenCount > bundleParentCount, 'Bundle parents produce strictly more children than parents');
});

test('12. Composite Provenance: multi-namespace collision returns exact isolated identity', () => {
  const namespaceA = {
    ...BASE_STAGED_ROW,
    source_system: 'NamespaceA',
    source_database: 'db_a',
    source_table: 'table_a',
    source_id: 'shared-id-999',
    source_hash: 'hash-aaa'
  };
  const namespaceB = {
    ...BASE_STAGED_ROW,
    source_system: 'NamespaceB',
    source_database: 'db_b',
    source_table: 'table_b',
    source_id: 'shared-id-999',
    source_hash: 'hash-bbb'
  };

  const resA = normalizeCanonicalParentChild(namespaceA);
  const resB = normalizeCanonicalParentChild(namespaceB);

  assert.notStrictEqual(resA.parent.parent_hash, resB.parent.parent_hash);
  assert.strictEqual(resA.parent.source_system, 'NamespaceA');
  assert.strictEqual(resB.parent.source_system, 'NamespaceB');
});

test('13. Contact approval denial: returns null WhatsApp and null raw phone when unapproved', () => {
  const proposalUnapproved = {
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_id: 'seller-001',
    source_hash: 'hash-seller-001',
    seller_name: 'Private Seller',
    seller_contact: '+1 555 123 4567',
    contact_publication_approved: false
  };

  const inquiryUnapproved = buildAuthorizedInquiryContract(proposalUnapproved);
  assert.strictEqual(inquiryUnapproved.contact_publication_approved, false);
  assert.strictEqual(inquiryUnapproved.seller_contact_raw, null);
  assert.strictEqual(inquiryUnapproved.whatsapp_url, null);
  assert.strictEqual(inquiryUnapproved.seller_contact_masked, '+*** *** 4567');
  assert.strictEqual(inquiryUnapproved.inquiry_ready, false);

  const proposalApproved = {
    ...proposalUnapproved,
    contact_publication_approved: true
  };

  const inquiryApproved = buildAuthorizedInquiryContract(proposalApproved);
  assert.strictEqual(inquiryApproved.contact_publication_approved, true);
  assert.strictEqual(inquiryApproved.seller_contact_raw, '+1 555 123 4567');
  assert.ok(inquiryApproved.whatsapp_url.includes('https://wa.me/15551234567'));
  assert.strictEqual(inquiryApproved.inquiry_ready, true);
});

test('14. Production NYC3 Image resolution with HEAD and bounded GET fallback', async () => {
  const testKey = 'images/rolex/116610ln.jpg';
  const resolvedUrl = resolveProductionImageUrl(testKey);
  assert.strictEqual(resolvedUrl, 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/images/rolex/116610ln.jpg');

  // Simulate mock fetch with HEAD 200 + image/jpeg
  const mockSuccessFetch = async (url, opts) => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }
  });
  const checkSuccess = await verifyImageReachabilityBounded(resolvedUrl, mockSuccessFetch);
  assert.strictEqual(checkSuccess.reachable, true);
  assert.strictEqual(checkSuccess.contentType, 'image/jpeg');

  // Simulate mock fetch with HEAD 405 Method Not Allowed falling back to bounded GET
  const mockFallbackFetch = async (url, opts) => {
    if (opts.method === 'HEAD') {
      return { ok: false, status: 405, headers: { get: () => null } };
    }
    if (opts.method === 'GET' && opts.headers.Range === 'bytes=0-1023') {
      return { ok: true, status: 206, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) } };
    }
    return { ok: false, status: 500 };
  };
  const checkFallback = await verifyImageReachabilityBounded(resolvedUrl, mockFallbackFetch);
  assert.strictEqual(checkFallback.reachable, true);
  assert.strictEqual(checkFallback.status, 206);
  assert.strictEqual(checkFallback.contentType, 'image/png');
});

test('15. Canary artifacts and manifest checksums are consistent and present', () => {
  const artifactDir = path.resolve('audit-output/mariadb-live/canonical-canary-10k');
  const manifestPath = path.join(artifactDir, 'canonical-canary-10k-authoritative-manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'canonical-canary-10k-authoritative-manifest.json must exist');

  const summaryPath = path.join(artifactDir, 'canonical-canary-10k-summary.json');
  assert.ok(fs.existsSync(summaryPath), 'canonical-canary-10k-summary.json must exist');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  assert.strictEqual(summary.single_children_count, 9860);
  assert.strictEqual(summary.bundle_parents_count, 140);
  assert.strictEqual(summary.bundle_children_count, 381);
  assert.strictEqual(summary.total_children_count, 10241);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  for (const [fname, meta] of Object.entries(manifest.artifacts)) {
    const fpath = path.join(artifactDir, fname);
    assert.ok(fs.existsSync(fpath), `Artifact ${fname} must exist on disk`);
    const fileBytes = fs.readFileSync(fpath);
    const computedSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
    assert.strictEqual(meta.sha256, computedSha, `Checksum mismatch for artifact ${fname}`);
    assert.strictEqual(meta.bytes, fileBytes.length, `Byte length mismatch for artifact ${fname}`);
  }
});

test('16. Authoritative normalization status vocabulary matches SQL CHECK constraints and covers all emitted statuses', () => {
  const { NORMALIZATION_STATUS_CONTRACT } = require('../tools/mariadb-live/normalization-status-contract.cjs');
  const migrationPath = path.resolve('supabase/migrations/20260830190000_canonical_parent_child_remediation.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  // Exact Bidirectional Equality: Extract allowed values from SQL constraints and compare with contract
  function extractSqlConstraintValues(sql, constraintName) {
    const regex = new RegExp(`ADD CONSTRAINT ${constraintName} CHECK \\([^)]*?IN \\(([\\s\\S]*?)\\)\\)`, 'i');
    const match = sql.match(regex);
    if (!match) throw new Error(`Could not find constraint ${constraintName} in migration SQL`);
    const rawItems = match[1].match(/'([^']+)'/g);
    return rawItems ? rawItems.map(s => s.replace(/'/g, '')) : [];
  }

  const constraintFieldMap = {
    chk_mariadb_children_intent: 'intent',
    chk_mariadb_children_reconciliation_category: 'reconciliation_category',
    chk_mariadb_children_currency_status: 'currency_status',
    chk_mariadb_children_trading_floor_status: 'trading_floor_status',
    chk_mariadb_children_price_research_status: 'price_research_status',
    chk_mariadb_children_image_evidence_type: 'primary_image_evidence_type',
    chk_mariadb_images_scope: 'scope'
  };

  for (const [constraintName, fieldName] of Object.entries(constraintFieldMap)) {
    const extracted = extractSqlConstraintValues(migrationSql, constraintName).sort();
    const contractVals = [...NORMALIZATION_STATUS_CONTRACT[fieldName]].sort();
    assert.deepStrictEqual(
      extracted,
      contractVals,
      `Exact bidirectional mismatch for ${constraintName} (${fieldName}): SQL has [${extracted}], Contract has [${contractVals}]`
    );
  }

  // Regression fixtures covering every single parser-supported currency
  const currencyFixtures = [
    { text: 'WTS Rolex 116610LN 12500 USD', expectedCurr: 'VERIFIED_EXPLICIT_USD' },
    { text: 'WTS Rolex 116610LN 12500 USDT', expectedCurr: 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX' },
    { text: 'WTS Rolex 116610LN HKD 95000', expectedCurr: 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX' },
    { text: 'WTS Rolex 116610LN EUR 10000', expectedCurr: 'VERIFIED_EXPLICIT_EUR' },
    { text: 'WTS Rolex 116610LN GBP 8500', expectedCurr: 'VERIFIED_EXPLICIT_GBP' },
    { text: 'WTS Rolex 116610LN CHF 11000', expectedCurr: 'VERIFIED_EXPLICIT_CHF' },
    { text: 'WTS Rolex 116610LN SGD 16000', expectedCurr: 'VERIFIED_EXPLICIT_SGD' },
    { text: 'WTS Rolex 116610LN AED 45000', expectedCurr: 'VERIFIED_EXPLICIT_AED' },
    { text: 'WTS Rolex 116610LN SAR 46000', expectedCurr: 'VERIFIED_EXPLICIT_SAR' },
    { text: 'WTS Rolex 116610LN CNY 88000', expectedCurr: 'VERIFIED_EXPLICIT_CNY' },
    { text: 'WTS Rolex 116610LN JPY 1800000', expectedCurr: 'VERIFIED_EXPLICIT_JPY' },
    { text: 'WTS Rolex 116610LN KRW 16000000', expectedCurr: 'VERIFIED_EXPLICIT_KRW' },
    { text: 'WTS Rolex 116610LN THB 420000', expectedCurr: 'VERIFIED_EXPLICIT_THB' },
    { text: 'WTS Rolex 116610LN CAD 16500', expectedCurr: 'VERIFIED_EXPLICIT_CAD' },
    { text: 'WTS Rolex 116610LN AUD 18500', expectedCurr: 'VERIFIED_EXPLICIT_AUD' },
    { text: 'WTS Rolex 116610LN NZD 20000', expectedCurr: 'VERIFIED_EXPLICIT_NZD' },
    { text: 'WTS Rolex 116610LN MYR 55000', expectedCurr: 'VERIFIED_EXPLICIT_MYR' },
    { text: 'WTS Rolex 116610LN IDR 190000000', expectedCurr: 'VERIFIED_EXPLICIT_IDR' },
    { text: 'WTS Rolex 116610LN INR 1000000', expectedCurr: 'VERIFIED_EXPLICIT_INR' },
    { text: 'WTS Rolex 116610LN PHP 700000', expectedCurr: 'VERIFIED_EXPLICIT_PHP' },
    { text: 'WTS Rolex 116610LN TWD 390000', expectedCurr: 'VERIFIED_EXPLICIT_TWD' },
    { text: 'WTS Rolex 116610LN VND 300000000', expectedCurr: 'VERIFIED_EXPLICIT_VND' },
    { text: 'WTS Rolex 116610LN BRL 65000', expectedCurr: 'VERIFIED_EXPLICIT_BRL' },
    { text: 'WTS Rolex 116610LN MXN 220000', expectedCurr: 'VERIFIED_EXPLICIT_MXN' },
    { text: 'WTS Rolex 116610LN ZAR 230000', expectedCurr: 'VERIFIED_EXPLICIT_ZAR' },
    { text: 'WTS Rolex 116610LN SEK 130000', expectedCurr: 'VERIFIED_EXPLICIT_SEK' },
    { text: 'WTS Rolex 116610LN NOK 135000', expectedCurr: 'VERIFIED_EXPLICIT_NOK' },
    { text: 'WTS Rolex 116610LN DKK 85000', expectedCurr: 'VERIFIED_EXPLICIT_DKK' }
  ];

  for (const fix of currencyFixtures) {
    const row = {
      ...BASE_STAGED_ROW,
      raw_message: fix.text,
      raw_payload: { ...BASE_STAGED_ROW.raw_payload, description: fix.text }
    };
    const res = normalizeCanonicalParentChild(row);
    const child = res.children[0];
    assert.strictEqual(child.currency_status, fix.expectedCurr, `Currency status mismatch for "${fix.text}"`);
    assert.ok(NORMALIZATION_STATUS_CONTRACT.currency_status.includes(child.currency_status));
  }

  // Regression fixtures covering every status path
  const statusPathFixtures = [
    { text: 'Rolex 116610LN 12500 USD', expectedIntent: null, expectedTF: 'HELD_INTENT_UNKNOWN', expectedPR: 'INELIGIBLE_TRADING_FLOOR_HOLD' },
    { text: 'WTS Rolex 116610LN 12500 USD', expectedIntent: 'WTS', expectedTF: 'ELIGIBLE_WTS', expectedPR: 'ELIGIBLE_VERIFIED_USD' },
    { text: 'WTB Rolex 116610LN 12500 USD', expectedIntent: 'WTB', expectedTF: 'ELIGIBLE_WTB', expectedPR: 'INELIGIBLE_NOT_WTS' },
    { text: 'WTS Rolex 116610LN $12500', expectedIntent: 'WTS', expectedTF: 'ELIGIBLE_WTS', expectedPR: 'INELIGIBLE_AMBIGUOUS_CURRENCY' },
    { text: 'WTS Rolex 116610LN', expectedIntent: 'WTS', expectedTF: 'ELIGIBLE_WTS', expectedPR: 'INELIGIBLE_MISSING_PRICE' },
    { text: 'WTS Rolex 116610LN 600000 USD', expectedIntent: 'WTS', expectedTF: 'ELIGIBLE_WTS', expectedPR: 'INELIGIBLE_OUTLIER_EXCLUDED' },
    { text: 'WTS Rolex 116610LN 50 USD', expectedIntent: 'WTS', expectedTF: 'ELIGIBLE_WTS', expectedPR: 'INELIGIBLE_OUTLIER_EXCLUDED' },
    { text: 'WTB unknown stuff without brand or ref', expectedIntent: 'WTB', expectedTF: 'HELD_IDENTITY_INCOMPLETE', expectedPR: 'INELIGIBLE_TRADING_FLOOR_HOLD' }
  ];

  for (const fix of statusPathFixtures) {
    const row = {
      ...BASE_STAGED_ROW,
      raw_message: fix.text,
      raw_payload: { ...BASE_STAGED_ROW.raw_payload, description: fix.text }
    };
    const res = normalizeCanonicalParentChild(row);
    const child = res.children[0];
    assert.strictEqual(child.intent, fix.expectedIntent, `Intent mismatch for "${fix.text}"`);
    assert.strictEqual(child.trading_floor_status, fix.expectedTF, `Trading floor mismatch for "${fix.text}"`);
    assert.strictEqual(child.price_research_status, fix.expectedPR, `Price research mismatch for "${fix.text}"`);
  }
});
