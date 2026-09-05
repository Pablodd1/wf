'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PRIORITY_REVIEW_CONTRACT,
  priorityReviewRow,
  run,
} = require('../tools/mariadb-live/build-priority-reference-review.cjs');
const { priorityFamily } = require('../tools/mariadb-live/audit-publication-readiness.cjs');
const { jsonLine, sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function proposal(source, candidate, overrides = {}) {
  return {
    source_record_id: source.source_record_id,
    source_hash: source.raw_sha256,
    bundle_status: overrides.bundle_status || 'SINGLE_CANDIDATE',
    catalog_confirmation: overrides.catalog_confirmation || { confirmed: true },
    review_disposition: overrides.review_disposition || 'READY_FOR_HUMAN_APPROVAL',
    review_reasons: overrides.review_reasons || ['CATALOG_CONFIRMED'],
    normalization: {
      normalization_version: 'v4.2-line-condition',
      proposed_candidates: candidate ? [candidate] : [],
    },
  };
}

test('priority families require both the exact brand and reference family', () => {
  assert.equal(priorityFamily('5712/1A', 'Patek Philippe'), 'PATEK_5712_FAMILY');
  assert.equal(priorityFamily('5712', 'Piaget'), null);
  assert.equal(priorityFamily('116500LN', 'Rolex'), 'ROLEX_116500_FAMILY');
  assert.equal(priorityFamily('116500LN', 'Patek Philippe'), null);
  assert.equal(priorityFamily('126500LN', 'Rolex'), null);
});

test('private priority row preserves raw evidence but hashes seller identity and authorizes nothing', () => {
  const source = sourceRecord({
    id: 'patek-1', type: 'sale', title: 'Patek Philippe 5712/1A blue USD 98000',
    from_number: '+15550000000', from_name: 'Source Seller', region: 'New York',
  });
  const row = priorityReviewRow(source, proposal(source, {
    brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', dial_color: 'Blue',
    prices: [{ is_primary: true, amount_original: 98000, amount_usd: 98000, currency_original: 'USD', currency_evidence: 'explicit_line_currency' }],
  }));
  assert.equal(row.contract, PRIORITY_REVIEW_CONTRACT);
  assert.equal(row.private_review_artifact, true);
  assert.equal(row.raw_message, source.raw_message);
  assert.equal(row.priority_family, 'PATEK_5712_FAMILY');
  assert.match(row.seller.seller_identity_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row.seller).includes('+15550000000'), false);
  assert.equal(row.seller.rating, null);
  assert.equal(row.seller.contact_publication_approved, false);
  assert.equal(row.human_review_decision, null);
  assert.equal(row.publication_authorized, false);
});

test('same seller and exact raw text group as duplicates without suppressing either row', () => {
  const first = sourceRecord({ id: '1', type: 'sale', title: 'Rolex 116500LN white USD 28000', from_number: '+15550000000' });
  const second = sourceRecord({ id: '2', type: 'sale', title: 'Rolex 116500LN white USD 28000', from_number: '+15550000000' });
  const candidate = {
    brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White',
    prices: [{ is_primary: true, amount_original: 28000, amount_usd: 28000, currency_original: 'USD', currency_evidence: 'explicit_line_currency' }],
  };
  const a = priorityReviewRow(first, proposal(first, candidate));
  const b = priorityReviewRow(second, proposal(second, candidate));
  assert.equal(a.exact_duplicate_fingerprint, b.exact_duplicate_fingerprint);
  assert.equal(a.offer_fingerprint, b.offer_fingerprint);
  assert.notEqual(a.source_record_id, b.source_record_id);
  assert.equal(a.publication_authorized, false);
  assert.equal(b.publication_authorized, false);
});

test('full priority review reconciles all source rows and excludes cross-brand numeric collisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-priority-review-'));
  try {
    const rawInput = path.join(root, 'raw.jsonl');
    const segment = path.join(root, 'segment');
    const output = path.join(root, 'output');
    fs.mkdirSync(segment);
    const sources = [
      sourceRecord({ id: '1', type: 'sale', title: 'Patek 5712/1A blue USD 98000' }),
      sourceRecord({ id: '2', type: 'search', title: 'WTB Rolex 116500LN white' }),
      sourceRecord({ id: '3', type: 'sale', title: 'Piaget 5712 USD 10000' }),
      sourceRecord({ id: '4', type: 'sale', title: 'Rolex 126500LN USD 30000' }),
    ];
    const proposals = [
      proposal(sources[0], { brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', dial_color: 'Blue', prices: [] }),
      proposal(sources[1], { brand: 'Rolex', reference: '116500LN', listing_type: 'WTB', dial_color: 'White', prices: [] }),
      proposal(sources[2], { brand: 'Piaget', reference: '5712', listing_type: 'WTS', prices: [] }),
      proposal(sources[3], { brand: 'Rolex', reference: '126500LN', listing_type: 'WTS', dial_color: 'White', prices: [] }),
    ];
    fs.writeFileSync(rawInput, sources.map(jsonLine).join(''));
    fs.writeFileSync(path.join(segment, 'normalization-proposals.jsonl'), proposals.map(jsonLine).join(''));
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      source_rows: 4,
      difference: 0,
      source_coverage_reconciled: true,
      totals: { error_rows: 0 },
      segments: [{ directory: segment }],
    }));
    const report = await run({ config: { rawInput, manifestPath, output } });
    assert.equal(report.source_rows, 4);
    assert.equal(report.priority_rows, 2);
    assert.equal(report.counts.family.PATEK_5712_FAMILY, 1);
    assert.equal(report.counts.family.ROLEX_116500_FAMILY, 1);
    assert.equal(report.counts.intent.WTS, 1);
    assert.equal(report.counts.intent.WTB, 1);
    assert.equal(report.production_writes, 0);
    assert.equal(report.publication_authorized_rows, 0);
    const rows = fs.readFileSync(report.packet_path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.some(row => row.candidate.brand === 'Piaget'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

