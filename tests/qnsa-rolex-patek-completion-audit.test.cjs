'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EXPECTED,
  PROJECT_REF,
  QUERIES,
  RUN_ID,
  assess,
  managementQuery,
} = require('../tools/audit/qnsa-rolex-patek-completion-audit.cjs');

test('audit is pinned to canonical QNSA and the immutable shadow run', () => {
  assert.equal(PROJECT_REF, 'qnsafosakvonzgfcsphh');
  assert.equal(RUN_ID, '17d6d831-86cd-5e67-9830-c881bcf16e0d');
  assert.deepEqual(EXPECTED.Rolex, {
    total: 1535763, wts: 1386508, wtb: 149255, priceResearch: 38521,
  });
  assert.deepEqual(EXPECTED['Patek Philippe'], {
    total: 937001, wts: 884326, wtb: 52675, priceResearch: 45638,
  });
});

test('every database statement is read-only and aggregate-only', () => {
  const forbidden = /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REFRESH)\b/i;
  for (const [name, sql] of Object.entries(QUERIES)) {
    assert.doesNotMatch(sql, forbidden, `${name} contains a write-capable statement`);
    assert.doesNotMatch(sql, /\b(?:raw_text|raw_message)\s+AS\s+evidence\b/i,
      `${name} must not return raw listing text`);
  }
});

test('management request sets the Supabase read_only flag', async () => {
  let request;
  const rows = await managementQuery('private-test-token', 'mock', 'SELECT 1 AS evidence',
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => '[{"evidence":1}]',
      };
    });
  assert.equal(request.url,
    'https://api.supabase.com/v1/projects/qnsafosakvonzgfcsphh/database/query');
  assert.equal(request.options.headers.Authorization, 'Bearer private-test-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    query: 'SELECT 1 AS evidence', read_only: true,
  });
  assert.deepEqual(rows, [{ evidence: 1 }]);
});

test('assessment fails closed on missing evidence and accepts a fully reconciled report', () => {
  const inventory = Object.entries(EXPECTED).map(([brand, expected]) => ({
    brand,
    total: expected.total,
    wts: expected.wts,
    wtb: expected.wtb,
    invalid_customer_status: 0,
    invalid_confirmed_mapping: 0,
    invalid_latest_mapping: 0,
    missing_required_lineage_key: 0,
  }));
  const priceResearch = Object.entries(EXPECTED).map(([brand, expected]) => ({
    brand,
    qualified: expected.priceResearch,
    invalid_qualified_usd: 0,
    qualified_missing_original_price: 0,
  }));
  const zeroLineage = Object.keys(EXPECTED).map(brand => ({
    brand,
    missing_parent_bridge: 0,
    missing_version_bridge: 0,
    missing_raw_parent: 0,
    missing_raw_version: 0,
    version_parent_mismatch: 0,
  }));
  const zeroDealers = Object.keys(EXPECTED).map(brand => ({
    brand, invalid_rating_qualification: 0,
  }));
  const cardCanary = Object.keys(EXPECTED).map(brand => ({
    brand,
    returned_cards: 24,
    missing_reference: 0,
    missing_intent: 0,
    missing_posting_date: 0,
    missing_raw_message: 0,
    missing_poster_or_dealer_evidence: 0,
    invalid_verified_price: 0,
    verified_price_missing_original: 0,
    invalid_availability: 0,
    invalid_confirmed_mapping: 0,
    invalid_latest_mapping: 0,
    invalid_dealer_rating: 0,
  }));
  const clean = {
    contracts: { evidence: { current_model_column: true } },
    run_state: { evidence: { status: 'COMPLETE' } },
    inventory_coverage: { evidence: inventory },
    price_research: { evidence: priceResearch },
    duplicate_identities: { evidence: {
      duplicate_offer_state_extra_rows: 0,
      duplicate_observation_extra_rows: 0,
    } },
    lineage_resolution: { evidence: zeroLineage },
    image_integrity: { evidence: {
      orphan_or_wrong_occurrence_links: 0,
      customer_safe_non_seller_links: 0,
      invalid_urls: 0,
    } },
    dealer_integrity: { evidence: zeroDealers },
    customer_card_canary: { evidence: cardCanary },
  };
  assert.deepEqual(assess(clean), []);
  const incomplete = structuredClone(clean);
  incomplete.inventory_coverage.evidence[0].total -= 1;
  incomplete.customer_card_canary.evidence[1].missing_raw_message = 1;
  incomplete.image_integrity.evidence.customer_safe_non_seller_links = 1;
  assert.deepEqual(assess(incomplete), [
    'Rolex:TOTAL_COUNT_MISMATCH',
    'UNSAFE_IMAGE_EVIDENCE',
    'Patek Philippe:CARD_MISSING_RAW_MESSAGE',
  ]);
});
