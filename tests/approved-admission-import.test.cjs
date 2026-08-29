'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');
const intake = require('../tools/intake/import-approved-admission-workbook.cjs');

function source(overrides = {}) {
  return {
    listing_id: 'tag-1',
    source_platform: 'WHATSAPP',
    source_group_id: 'group-1',
    source_message_id: 'message-1',
    source_posted_at: '2026-08-11T12:00:00Z',
    ingested_at: '2026-08-11T12:01:00Z',
    raw_message: 'TAG Heuer Carrera CBS2210.FC6534 blue dial WTS USD 6500',
    intent: 'WTS',
    category: 'WATCH',
    asking_price_raw: 'USD 6500',
    source_currency: 'USD',
    normalized_price_usd: 6500,
    fx_source: 'SOURCE_USD',
    fx_rate_date: '2026-08-11',
    image_keys: 'image-1',
    image_urls_source: 'https://example.test/image.jpg',
    image_count_source: 1,
    duplicate_status_source: 'UNIQUE',
    seller_source_id: 'seller-1',
    seller_name_source: 'Seller One',
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    listing_id: 'tag-1',
    final_brand: 'TAG Heuer',
    final_model: 'Carrera',
    final_reference: 'CBS2210.FC6534',
    dial_normalized: 'Blue',
    identity_status: 'VERIFIED',
    bundle_status: 'SINGLE_CANDIDATE',
    image_status: 'VERIFIED',
    duplicate_decision: 'COUNT',
    trading_floor_status: 'PUBLISH',
    price_research_status: 'ELIGIBLE',
    review_reason: '',
    reviewed_by: 'owner',
    reviewed_at: '2026-08-16T00:00:00Z',
    ...overrides,
  };
}

test('strict admission mapping preserves lineage and fails contact closed', () => {
  const row = intake.rowForImport({
    source: source(),
    decision: decision(),
    expectedBrand: 'TAG Heuer',
    fileName: 'TAG_Heuer_Trading_Floor_Admission_Master.xlsx',
    fileSha256: 'a'.repeat(64),
    rowNumber: 2,
    runId: 'test',
  });
  assert.equal(row.brand_scope, 'TAG Heuer');
  assert.equal(row.model, 'Carrera');
  assert.equal(row.normalized_reference, 'CBS2210.FC6534');
  assert.equal(row.raw_message, source().raw_message);
  assert.equal(row.source_record_id, 'tag-1');
  assert.equal(row.user_image_url, 'https://example.test/image.jpg');
  assert.equal(row.price_evidence_status, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(row.contact_publication_approved, false);
  assert.equal(row.phone_number, null);
});

test('bundle parents and unresolved identities never produce import rows', () => {
  assert.equal(intake.rowForImport({
    source: source(), decision: decision({ bundle_status: 'BUNDLE_PARENT' }),
    expectedBrand: 'TAG Heuer', fileName: 'input.xlsx', fileSha256: 'b'.repeat(64),
    rowNumber: 2, runId: 'test',
  }), null);
  assert.equal(intake.rowForImport({
    source: source(), decision: decision({ final_model: '' }),
    expectedBrand: 'TAG Heuer', fileName: 'input.xlsx', fileSha256: 'b'.repeat(64),
    rowNumber: 2, runId: 'test',
  }), null);
});

test('single-row admission uses the same raw multi-item quarantine as the public API', () => {
  const risky = source({
    raw_message: 'Rolex 126500 and Patek 5712 available',
    listing_id: 'cross-brand-single',
  });
  assert.ok(intake.additionalImportReasons(risky).includes('RAW_MULTI_ITEM_RISK'));
  assert.equal(intake.rowForImport({
    source: risky,
    decision: decision({ listing_id: 'cross-brand-single' }),
    expectedBrand: 'TAG Heuer', fileName: 'input.xlsx',
    fileSha256: 'a'.repeat(64), rowNumber: 2, runId: 'test',
  }), null);
});

test('reviewed workbook admission rejects explicit and catalog-backed cross-brand identity', () => {
  const catalogConflict = source({
    raw_message: 'New 126618LB June 24 $39k + ship',
    listing_id: 'wrong-tag-reference',
  });
  const catalogDecision = decision({
    listing_id: 'wrong-tag-reference',
    final_reference: '126618LB',
    final_model: 'TAG Heuer Collection',
  });
  assert.deepEqual(
    intake.admissionIdentityConflictReasons(catalogConflict, catalogDecision, 'TAG Heuer'),
    ['CATALOG_BRAND_SCOPE_CONFLICT'],
  );
  assert.equal(intake.rowForImport({
    source: catalogConflict, decision: catalogDecision, expectedBrand: 'TAG Heuer',
    fileName: 'input.xlsx', fileSha256: 'a'.repeat(64), rowNumber: 2, runId: 'test',
  }), null);

  const explicitConflict = source({
    raw_message: 'Patek Philippe 5712/1A WTS USD 90000',
    listing_id: 'wrong-breguet-brand',
  });
  const explicitDecision = decision({
    listing_id: 'wrong-breguet-brand', final_brand: 'Breguet',
    final_reference: '5712/1A', final_model: 'Classique',
  });
  assert.ok(intake.admissionIdentityConflictReasons(
    explicitConflict, explicitDecision, 'Breguet',
  ).includes('RAW_BRAND_SCOPE_CONFLICT'));
});

test('generic collection words are not explicit competing-brand quarantine proof', () => {
  assert.deepEqual(intake.strictExplicitBrandsInRaw(
    'Ships overseas; seller Santos confirmed availability',
  ), []);
  assert.deepEqual(intake.strictExplicitBrandsInRaw(
    'Vacheron Constantin Overseas 4500V available',
  ), ['Vacheron Constantin']);
});

test('tainted reviewed workbooks require positive expected-brand identity evidence', () => {
  const unsupported = source({
    raw_message: '214270 full set USD 8,000', listing_id: 'unsupported-tag',
  });
  const unsupportedDecision = decision({
    listing_id: 'unsupported-tag', final_reference: '214270', final_model: 'TAG Heuer Collection',
  });
  assert.ok(intake.admissionIdentityGateReasons(
    unsupported, unsupportedDecision, 'TAG Heuer',
  ).length > 0);

  const supported = source({
    raw_message: 'TAG Heuer Carrera CBS2210.FC6534 USD 6,500', listing_id: 'supported-tag',
  });
  const supportedDecision = decision({ listing_id: 'supported-tag' });
  assert.deepEqual(intake.admissionIdentityGateReasons(
    supported, supportedDecision, 'TAG Heuer',
  ), []);
});

test('reviewed workbook admission rejects a year mistaken for a reference', () => {
  assert.deepEqual(intake.admissionIdentityConflictReasons(
    source({ raw_message: 'Breguet ladies oval circa 1970', listing_id: 'year-ref' }),
    decision({ listing_id: 'year-ref', final_brand: 'Breguet', final_reference: '1970' }),
    'Breguet',
  ), ['REFERENCE_IS_YEAR_TOKEN']);
});

test('single-row admission holds unresolved intent before database import', () => {
  const unresolved = source({
    raw_message: 'Franck Muller Vanguard V45 green dial',
    intent: 'OTHER',
  });
  assert.ok(intake.additionalImportReasons(unresolved).includes('LISTING_TYPE_UNRESOLVED'));
  assert.equal(intake.rowForImport({
    source: unresolved,
    decision: decision({
      final_brand: 'Franck Muller',
      final_model: 'Vanguard',
      final_reference: 'V45',
      dial_normalized: 'Green',
    }),
    expectedBrand: 'Franck Muller', fileName: 'input.xlsx',
    fileSha256: 'a'.repeat(64), rowNumber: 2, runId: 'test',
  }), null);
});

test('multi-parent lane emits one lineage-keyed display-only row with no inherited evidence', () => {
  const entries = [1, 2].map((number, index) => ({
    source: source({
      listing_id: `child-${number}`,
      source_message_id: 'immutable-message-1',
      raw_message: number === 1 ? 'Rolex 126500' : 'Patek 5712',
      image_urls_source: `https://example.test/parent-${number}.jpg`,
      seller_source_id: 'seller-1',
      seller_name_source: 'Seller One',
    }),
    decision: decision({ listing_id: `child-${number}` }),
    expectedBrand: number === 1 ? 'Rolex' : 'Patek Philippe',
    rowNumber: index + 2,
  }));
  const result = intake.buildMultiParentRows({
    entries,
    expectedBrand: 'TAG Heuer',
    fileName: 'input.xlsx',
    fileSha256: 'a'.repeat(64),
    runId: 'test',
  });
  assert.equal(result.parents.length, 1);
  const parent = result.parents[0];
  assert.match(parent.id, /^admission_multi_[0-9a-f]{64}$/);
  assert.equal(parent.source_record_id, 'immutable-message-1');
  assert.equal(parent.raw_message, 'Rolex 126500\nPatek 5712');
  assert.equal(parent.listing_type, 'MULTI');
  assert.equal(parent.verification_status, 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY');
  assert.equal(parent.verification_tier, 'OWNER_MULTI_PARENT_SOURCE_LINEAGE_V1');
  assert.equal(parent.price_evidence_status, 'MULTI_PARENT_PRICE_WITHHELD');
  assert.equal(parent.workbook_price_usd, null);
  assert.equal(parent.source_price_amount, null);
  assert.equal(parent.final_image_url, null);
  assert.equal(parent.phone_number, null);
  assert.equal(parent.contact_publication_approved, false);
});

test('single workbook row remains held even when the ledger labels it as a bundle', () => {
  const base = {
    source: source({ source_message_id: 'bundle-message', raw_message: 'Several watches available' }),
    decision: decision({ bundle_status: 'BUNDLE_PENDING' }),
    rowNumber: 2,
  };
  const held = intake.buildMultiParentRows({
    entries: [base], expectedBrand: 'TAG Heuer', fileName: 'a.xlsx',
    fileSha256: 'b'.repeat(64), runId: 'test',
  });
  assert.equal(held.parents.length, 0);
  assert.deepEqual(held.held[0].reasons, ['MULTI_PARENT_DISTINCT_CHILD_PROOF_MISSING']);
  assert.equal(intake.buildMultiParentRows({
    entries: [{ ...base, decision: decision({ bundle_status: 'UNKNOWN' }) }],
    expectedBrand: 'TAG Heuer', fileName: 'a.xlsx',
    fileSha256: 'b'.repeat(64), runId: 'test',
  }).parents.length, 0);
});

test('same immutable source message produces the same parent id across workbook copies', () => {
  const make = brand => intake.buildMultiParentRows({
    entries: [1, 2].map((number, index) => ({
      source: source({
        listing_id: `${brand}-child-${number}`,
        source_message_id: 'shared-source',
        raw_message: `Mixed brand dealer list item ${number}`,
      }),
      decision: decision({ bundle_status: 'BUNDLE_PENDING' }),
      rowNumber: index + 2,
    })), expectedBrand: brand, fileName: `${brand}.xlsx`,
    fileSha256: brand === 'Breguet' ? 'c'.repeat(64) : 'd'.repeat(64), runId: 'test',
  }).parents[0];
  assert.equal(make('Breguet').id, make('Franck Muller').id);
});

test('multi-parent raw brand conflicts remain held instead of routing through the workbook brand', () => {
  const result = intake.buildMultiParentRows({
    entries: [1, 2].map((number, index) => ({
      source: source({
        listing_id: `chopard-child-${number}`,
        source_message_id: 'wrong-brand-parent',
        raw_message: number === 1 ? 'RM016 WG USD 77500' : 'RM030TI USD 162400',
      }),
      decision: decision({ bundle_status: 'BUNDLE_PENDING' }),
      rowNumber: index + 2,
    })),
    expectedBrand: 'Chopard', fileName: 'chopard.xlsx',
    fileSha256: 'e'.repeat(64), runId: 'test',
  });
  assert.equal(result.parents.length, 0);
  assert.deepEqual(result.held[0].reasons, ['MULTI_PARENT_RAW_BRAND_CONFLICT']);
});

test('Trading Floor admission cannot silently promote a Price Research hold', () => {
  const row = intake.rowForImport({
    source: source({ fx_source: '', fx_rate_date: '' }),
    decision: decision(),
    expectedBrand: 'TAG Heuer',
    fileName: 'input.xlsx',
    fileSha256: 'c'.repeat(64),
    rowNumber: 2,
    runId: 'test',
  });
  assert.ok(row);
  assert.equal(row.price_evidence_status, 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE');
  assert.deepEqual(row.review_reasons, ['PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE']);
});

test('non-USD FX remains review evidence but is excluded from current analytics', () => {
  const evidence = intake.sourcePriceEvidence(source({
    raw_message: 'TAG Heuer Carrera CBS2210.FC6534 HKD 50000',
    asking_price_raw: 'HKD 50000',
    source_currency: 'HKD',
    normalized_price_usd: 6410,
    fx_source: 'ECB',
    fx_rate_date: '2026-08-11',
  }));
  assert.equal(evidence.sourceAmount, 50000);
  assert.equal(evidence.workbookPriceUsd, 6410);
  assert.equal(evidence.status, 'DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR');
});

test('workbook currency cannot contradict the exact raw currency evidence', () => {
  const evidence = intake.sourcePriceEvidence(source({
    raw_message: 'TAG Heuer Carrera HKD 50,000', asking_price_raw: 'HKD 50000',
    source_currency: 'USD', normalized_price_usd: 6410,
    fx_source: 'SOURCE_STATED', fx_rate_date: '2026-08-11',
  }));
  assert.equal(evidence.status, 'PRICE_EVIDENCE_INCOMPLETE');
});

test('bare-dollar evidence is never promoted to explicit USD in owner-unbundled mode', () => {
  const evidence = intake.sourcePriceEvidence(source({
    raw_message: 'H. Moser Streamliner 6200-1200 WTS $13,500',
    asking_price_raw: '$13,500',
    source_currency: 'USD',
    normalized_price_usd: 13500,
  }), { rawExplicitUsdOnly: true });
  assert.equal(evidence.status, 'PRICE_NOT_SUPPLIED');
  assert.equal(evidence.currency, null);
  assert.equal(evidence.workbookPriceUsd, null);
});

test('exact duplicate candidates retain one deterministic canonical row', () => {
  const base = intake.rowForImport({
    source: source(), decision: decision(), expectedBrand: 'TAG Heuer',
    fileName: 'input.xlsx', fileSha256: '1'.repeat(64), rowNumber: 3, runId: 'test',
  });
  const earlier = {
    ...base,
    id: 'earlier',
    content_hash: 'earlier-hash',
    source_row_number: 2,
    posting_date: '2026-08-10T12:00:00Z',
    source_payload_sha256: '2'.repeat(64),
  };
  const resolution = intake.canonicalizeExactDuplicates([base, earlier]);
  assert.equal(resolution.canonical.length, 1);
  assert.equal(resolution.canonical[0].id, 'earlier');
  assert.equal(resolution.excluded.length, 1);
  assert.equal(resolution.excluded[0].disposition, 'DUPLICATE/REPOST');
  assert.equal(resolution.excluded[0].canonical_id, 'earlier');
  assert.equal(resolution.excluded[0].excluded_id, base.id);
});

test('ledger duplicate evidence is hashed and excludes raw/contact values', () => {
  const evidence = intake.ledgerDuplicateEvidence({
    source: source(),
    decision: decision({ duplicate_decision: 'REPOST' }),
    fileSha256: '3'.repeat(64),
    rowNumber: 9,
  });
  assert.equal(evidence.disposition, 'DUPLICATE/REPOST');
  assert.match(evidence.evidence_basis, /REPOST/);
  assert.equal(evidence.source_row_number, 9);
  assert.equal(Object.hasOwn(evidence, 'raw_message'), false);
  assert.equal(Object.hasOwn(evidence, 'seller_name_source'), false);
});

test('owner-reviewed unbundled children publish without inherited media and use exact child USD', () => {
  const row = intake.rowForImport({
    source: source({
      listing_id: 'moser-child-1',
      source_message_id: 'moser-message-1_item_1',
      raw_message: 'H. Moser Streamliner 6200-1200 black dial available USD 13,500',
      intent: 'WTS',
      image_urls_source: 'https://example.test/parent-bundle.jpg',
      normalized_price_usd: 13,
    }),
    decision: decision({
      listing_id: 'moser-child-1',
      final_brand: 'H. Moser & Cie',
      final_model: 'Streamliner',
      final_reference: 'MOSER',
      dial_normalized: 'Black',
      review_reason: 'UNBUNDLED_STANDALONE_PASSED',
    }),
    expectedBrand: 'H. Moser & Cie',
    fileName: 'H_Moser_Unbundled_Admission_Master.xlsx',
    fileSha256: 'd'.repeat(64),
    rowNumber: 2,
    runId: 'test',
    ownerUnbundled: true,
  });
  assert.ok(row);
  assert.equal(row.normalized_reference, '62001200');
  assert.equal(row.workbook_price_usd, 13500);
  assert.equal(row.price_evidence_status, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(row.final_image_url, null);
  assert.equal(row.image_evidence_type, null);
  assert.ok(row.review_reasons.includes('UNBUNDLED_CHILD_NO_IMAGE_APPROVED'));
  assert.ok(row.review_reasons.includes('RAW_USD_REEXTRACTED_OVERRIDES_WORKBOOK_VALUE'));
});

test('owner-reviewed unbundled WTB remains demand and never becomes priced inventory', () => {
  const row = intake.rowForImport({
    source: source({
      listing_id: 'zenith-child-1',
      source_message_id: 'zenith-message-1_item_1',
      raw_message: 'Looking for Zenith 03.3100.3600/69.M3100 budget $12,000',
      intent: 'WTS',
      image_urls_source: '',
    }),
    decision: decision({
      listing_id: 'zenith-child-1',
      final_brand: 'Zenith',
      final_model: 'Defy',
      final_reference: 'ZENITH',
      review_reason: 'UNBUNDLED_STANDALONE_PASSED',
    }),
    expectedBrand: 'Zenith', fileName: 'Zenith.xlsx', fileSha256: 'e'.repeat(64),
    rowNumber: 2, runId: 'test', ownerUnbundled: true,
  });
  assert.ok(row);
  assert.equal(row.listing_type, 'WTB');
  assert.equal(row.workbook_price_usd, null);
  assert.equal(row.price_evidence_status, 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE');
});

test('unbundled rows without an exact child reference remain visible but out of Price Research', () => {
  const row = intake.rowForImport({
    source: source({
      listing_id: 'blancpain-child-1', source_message_id: 'bp-message-1_item_1',
      raw_message: 'Blancpain Fifty Fathoms available USD 18000', image_urls_source: '',
    }),
    decision: decision({
      listing_id: 'blancpain-child-1', final_brand: 'Blancpain', final_model: 'Fifty Fathoms',
      final_reference: 'BLANCPAIN', review_reason: 'UNBUNDLED_STANDALONE_PASSED',
    }),
    expectedBrand: 'Blancpain', fileName: 'Blancpain.xlsx', fileSha256: 'f'.repeat(64),
    rowNumber: 2, runId: 'test', ownerUnbundled: true,
  });
  assert.ok(row);
  assert.equal(row.normalized_reference, null);
  assert.equal(row.raw_reference, null);
  assert.equal(row.workbook_price_usd, 18000);
  assert.equal(row.price_evidence_status, 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE');
  assert.ok(row.review_reasons.includes('EXACT_REFERENCE_NOT_RECOVERED_FROM_CHILD_RAW'));
});

test('owner-reviewed unbundled references use exact brand-specific child evidence across the reviewed brand set', () => {
  assert.equal(
    intake.strictReferenceFromRaw(
      'Omega Speedmaster 310.30.42.50.01.002 available USD 7,250',
      'Omega',
      '310.30.42.50.01.002',
      'USD 7,250',
    ),
    '310.30.42.50.01.002',
  );
  assert.equal(
    intake.strictReferenceFromRaw(
      'LIKE NEW Zenith Defy Double Tourbillon 10.9000.9020/79.R918 CARBON',
      'Zenith',
      'LIKE',
      null,
    ),
    '10.9000.9020/79.R918',
  );
});

test('owner-reviewed unbundled references reject brand labels and accessory child segments', () => {
  assert.equal(
    intake.strictReferenceFromRaw('🌟H.Moser & Cie🌟', 'H. Moser & Cie', 'MOSER', null),
    null,
  );
  assert.equal(
    intake.strictReferenceFromRaw(
      'Box & Papers + EXTRA STRAP + CARDHOLDER',
      'Zenith',
      'EXTRA',
      null,
    ),
    null,
  );
});

test('apply readback requires exact hashes, no inherited media or contact, and the expected price lane', () => {
  const expected = intake.rowForImport({
    source: source({
      listing_id: 'omega-child-1',
      source_message_id: 'omega-parent-1_item_1',
      raw_message: 'Omega Speedmaster 310.30.42.50.01.002 black dial available USD 7,250',
      intent: 'WTS',
      image_urls_source: 'https://example.test/parent.jpg',
    }),
    decision: decision({
      listing_id: 'omega-child-1',
      final_brand: 'Omega',
      final_model: 'Speedmaster',
      final_reference: '310.30.42.50.01.002',
      dial_normalized: 'Black',
      review_reason: 'UNBUNDLED_STANDALONE_PASSED',
    }),
    expectedBrand: 'Omega',
    fileName: 'Omega.xlsx',
    fileSha256: 'a'.repeat(64),
    rowNumber: 2,
    runId: 'test',
    ownerUnbundled: true,
  });
  assert.ok(expected);
  const clean = intake.compareImportedRows([expected], [{ ...expected }]);
  assert.equal(clean.ok, true);
  assert.equal(clean.exact, 1);

  const leaked = intake.compareImportedRows([expected], [{
    ...expected,
    content_hash: 'drifted',
    final_image_url: 'https://example.test/parent.jpg',
    phone_number: '13055550100',
    contact_publication_approved: true,
    price_evidence_status: 'PRICE_NOT_SUPPLIED',
  }]);
  assert.equal(leaked.ok, false);
  assert.deepEqual(leaked.missing_ids, []);
  assert.ok(leaked.drift[0].fields.includes('content_hash'));
  assert.ok(leaked.drift[0].fields.includes('final_image_url'));
  assert.ok(leaked.drift[0].fields.includes('phone_number'));
  assert.ok(leaked.drift[0].fields.includes('contact_publication_approved'));
  assert.ok(leaked.drift[0].fields.includes('price_research_status'));
});

test('exact owner-unbundled replacement updates existing IDs only when explicitly requested', async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, intake.INVENTORY_TABLE);
      return {
        upsert(rows, options) {
          calls.push({ rows, options });
          return { select: async () => ({ data: rows.map(row => ({ id: row.id })), error: null }) };
        },
      };
    },
  };
  const rows = [{ id: 'admission_exact_1' }];
  assert.equal(await intake.upsertBatch(client, rows), 1);
  assert.equal(calls[0].options.ignoreDuplicates, true);
  assert.equal(await intake.upsertBatch(client, rows, { replaceExisting: true }), 1);
  assert.equal(calls[1].options.ignoreDuplicates, false);
  assert.equal(calls[1].options.onConflict, 'id');
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'tools/intake/import-approved-admission-workbook.cjs'),
    'utf8',
  );
  assert.match(source, /inserted = options\.replaceExisting \? 0 : Number\(checkpoint\?\.rows_inserted/);
  assert.match(source, /duplicates = options\.replaceExisting \? 0 : Number\(checkpoint\?\.rows_duplicate_held/);
});

test('owner-unbundled dial survives only exact raw or catalog confirmation', () => {
  assert.equal(intake.verifiedOwnerUnbundledDial({
    rawMessage: 'Omega Speedmaster 310.30.42.50.01.002 black dial USD 7,250',
    brand: 'Omega',
    reference: '310.30.42.50.01.002',
    claimedDial: 'Black',
  }), 'Black');
  assert.equal(intake.verifiedOwnerUnbundledDial({
    rawMessage: 'Omega Speedmaster 310.30.42.50.01.002 mint condition USD 7,250',
    brand: 'Omega',
    reference: '310.30.42.50.01.002',
    claimedDial: 'Green',
  }), null);
});

test('owner-unbundled reference and identity gates reject words, years, prices, and competing brands', () => {
  for (const token of ['MASTER', 'UNIQUE', 'LEGEND', '2001YEAR', '500.00', 'GOOD']) {
    assert.equal(intake.strictReferenceFromRaw(
      `Jaeger-LeCoultre ${token} available USD 10,000`,
      'Jaeger-LeCoultre',
      token,
      'USD 10,000',
    ), null);
  }
  assert.equal(intake.ownerUnbundledIdentitySupported({
    rawMessage: 'Jacob & Co LEGEND available USD 10,000',
    brand: 'Audemars Piguet',
    reference: 'LEGEND',
  }), false);
});

test('owner-unbundled model is kept only from exact child raw or exact same-brand catalog', () => {
  assert.deepEqual(intake.verifiedOwnerUnbundledModel({
    rawMessage: 'Omega Speedmaster 310.30.42.50.01.002 black dial',
    brand: 'Omega',
    reference: '310.30.42.50.01.002',
    claimedModel: 'Speedmaster',
  }), { model: 'Speedmaster', catalogModel: null, evidence: 'EXACT_CHILD_RAW_MODEL' });
  assert.deepEqual(intake.verifiedOwnerUnbundledModel({
    rawMessage: 'Unknown watch ABC123',
    brand: 'Omega',
    reference: 'ABC123',
    claimedModel: 'Speedmaster',
  }), { model: null, catalogModel: null, evidence: null });
});

test('owner unbundle mode is fail-closed to the reviewed brand allowlist', async () => {
  await assert.rejects(
    intake.run(['--input', 'not-opened.xlsx', '--brand', 'Rolex', '--unbundled-no-image', 'true']),
    /not allowlisted/,
  );
});

test('unresolved trade intent is held instead of entering the WTS or WTB publication lane', () => {
  const admission = intake.classifyOwnerUnbundledRow(
    source({ raw_message: 'H. Moser Streamliner 6200-1200 trade considered', intent: 'OTHER' }),
    decision({ final_brand: 'H. Moser & Cie', final_model: 'Streamliner', review_reason: 'UNBUNDLED_STANDALONE_PASSED' }),
    'H. Moser & Cie',
  );
  assert.equal(admission.trading_floor_candidate, false);
  assert.ok(admission.reasons.includes('LISTING_TYPE_UNRESOLVED'));
});

test('dry-run emits reconciled aggregate canary with zero database writes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-import-'));
  const file = path.join(temp, 'TAG_Heuer_Trading_Floor_Admission_Master.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    source(),
    source({ listing_id: 'tag-bundle', source_message_id: 'message-2' }),
  ]), 'Trading Floor & Price Research');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    decision(),
    decision({ listing_id: 'tag-bundle', bundle_status: 'BUNDLE_PARENT' }),
  ]), 'TAG Admission Decisions');
  XLSX.writeFile(workbook, file);
  const report = await intake.run([
    '--input', file,
    '--brand', 'TAG Heuer',
    '--output-dir', path.join(temp, 'output'),
    '--max-rows', '25',
  ]);
  assert.equal(report.mode, 'LOCAL_DRY_RUN');
  assert.equal(report.source_rows, 2);
  assert.equal(report.strict_trading_floor_candidates, 1);
  assert.equal(report.selected_rows, 1);
  assert.equal(report.bundle_rows_selected, 0);
  assert.equal(report.contact_publication_approved_rows, 0);
  assert.equal(report.database_writes, 0);
  assert.equal(report.held_reasons.BUNDLE_PENDING_SEPARATION, 1);
});
