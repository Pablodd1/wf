'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MEDIA_AUDIT_CONTRACT,
  auditCandidate,
  ledgerCandidate,
  run,
  validateMediaUrl,
} = require('../tools/mariadb-live/audit-exact-source-media.cjs');
const { stagingRecord } = require('../tools/mariadb-live/import-normalized-staging.cjs');
const { jsonLine, sourceRecord } = require('../tools/mariadb-live/lib.cjs');

const allowedHosts = new Set(['thecollective-prod.nyc3.digitaloceanspaces.com']);

function response(status, contentType) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
  };
}

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

test('media URL safety is HTTPS, host, path, and image-extension constrained', () => {
  const safe = validateMediaUrl('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/watch%201.jpg', allowedHosts);
  assert.equal(safe.safe, true);
  assert.match(safe.url, /watch%201\.jpg$/);
  assert.equal(validateMediaUrl('http://thecollective-prod.nyc3.digitaloceanspaces.com/listings/1.jpg', allowedHosts).reason, 'NON_HTTPS_URL');
  assert.equal(validateMediaUrl('https://evil.example/listings/1.jpg', allowedHosts).reason, 'UNAPPROVED_MEDIA_HOST');
  assert.equal(validateMediaUrl('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/%2e%2e/secret.jpg', allowedHosts).reason, 'UNSAFE_OBJECT_PATH');
  assert.equal(validateMediaUrl('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/1.pdf', allowedHosts).reason, 'UNSUPPORTED_IMAGE_EXTENSION');
});

test('only a reachable image content type becomes a review candidate', async () => {
  const candidate = {
    contract: MEDIA_AUDIT_CONTRACT,
    source_record_id: 'mysql_auctions_1',
    source_hash: 'a'.repeat(64),
    source_candidate_hash: 'b'.repeat(64),
    category: 'WATCH', brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    source_media_key: '1.jpg',
    source_media_url_candidate: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/1.jpg',
    exact_source_lineage: true,
    bundle_status: 'SINGLE_CANDIDATE',
  };
  const accepted = await auditCandidate(candidate, {
    allowedHosts, timeoutMs: 1000, fetchImpl: async () => response(200, 'image/jpeg'),
  });
  assert.equal(accepted.recommendation, 'SAFE_LINEAGE_CANDIDATE_REVIEW');
  assert.equal(accepted.url_reachable, true);
  assert.equal(accepted.reason, null);

  const rejected = await auditCandidate(candidate, {
    allowedHosts, timeoutMs: 1000, fetchImpl: async () => response(200, 'text/html'),
  });
  assert.equal(rejected.recommendation, 'DEFER');
  assert.equal(rejected.reason, 'CONTENT_TYPE_UNVERIFIED');
});

test('media ledger candidate contains lineage and identity but no raw or seller fields', () => {
  const source = sourceRecord({
    id: '1', type: 'sale', title: 'Rolex 116500LN white USD 28000',
    front_image: '1_front_image.jpg', from_number: '+15550000000', from_name: 'Private Seller',
  });
  const normalized = stagingRecord(source, proposal(source, {
    brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White', prices: [],
  }));
  const row = ledgerCandidate(normalized);
  assert.equal(row.source_record_id, source.source_record_id);
  assert.equal(row.reference, '116500LN');
  assert.equal(Object.hasOwn(row, 'raw_message'), false);
  assert.equal(JSON.stringify(row).includes('+15550000000'), false);
  assert.equal(JSON.stringify(row).includes('Private Seller'), false);
});

test('full audit reconciles source coverage and defers all bundle media', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-exact-media-audit-'));
  try {
    const rawInput = path.join(root, 'raw.jsonl');
    const segment = path.join(root, 'segment');
    const output = path.join(root, 'output');
    fs.mkdirSync(segment);
    const sources = [
      sourceRecord({ id: '1', type: 'sale', title: 'Rolex 116500LN white USD 28000', front_image: '1.jpg' }),
      sourceRecord({ id: '2', type: 'sale', is_bundle: 1, title: 'Rolex 116500LN / Patek 5712', front_image: 'bundle.jpg' }),
      sourceRecord({ id: '3', type: 'search', title: 'WTB Patek 5712/1A blue' }),
      sourceRecord({ id: '4', type: 'sale', title: 'Hermes Birkin 30 bag USD 24000', front_image: 'bag.png' }),
    ];
    const proposals = [
      proposal(sources[0], { brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White', prices: [] }),
      proposal(sources[1], { brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', prices: [] }, { bundle_status: 'BUNDLE_SPLIT_REQUIRED', review_disposition: 'HUMAN_REVIEW' }),
      proposal(sources[2], { brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTB', dial_color: 'Blue', prices: [] }),
      proposal(sources[3], null, { catalog_confirmation: { confirmed: false }, review_disposition: 'HUMAN_REVIEW', review_reasons: ['NON_WATCH_CATEGORY'] }),
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

    const report = await run({
      config: {
        rawInput, manifestPath, output, concurrency: 2, limit: 10, timeoutMs: 1000, allowedHosts,
      },
      fetchImpl: async () => response(200, 'image/jpeg'),
    });
    assert.equal(report.source_rows, 4);
    assert.equal(report.exact_source_media_rows, 3);
    assert.equal(report.no_source_media_rows, 1);
    assert.equal(report.bundle_media_deferred, 1);
    assert.equal(report.audited_single_media_rows, 2);
    assert.equal(report.safe_lineage_candidates_for_review, 2);
    assert.equal(report.complete_for_available_single_media, true);
    assert.equal(report.production_writes, 0);
    assert.match(report.ledger_sha256, /^[0-9a-f]{64}$/);
    const ledger = fs.readFileSync(report.ledger_path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(ledger.length, 2);
    assert.equal(ledger.some(row => row.source_media_key === 'bundle.jpg'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

