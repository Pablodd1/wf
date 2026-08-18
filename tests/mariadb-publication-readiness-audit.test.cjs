'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { run } = require('../tools/mariadb-live/audit-publication-readiness.cjs');
const { jsonLine, sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function normalized(source, candidate, overrides = {}) {
  return {
    source_record_id: source.source_record_id,
    source_hash: source.raw_sha256,
    bundle_status: overrides.bundle_status || 'SINGLE_CANDIDATE',
    catalog_confirmation: overrides.catalog_confirmation || { confirmed: true },
    review_disposition: overrides.review_disposition || 'READY_FOR_HUMAN_APPROVAL',
    review_reasons: overrides.review_reasons || ['CATALOG_CONFIRMED'],
    normalization: { normalization_version: 'v4.2-line-condition', proposed_candidates: candidate ? [candidate] : [] },
  };
}

test('streams a fully reconciled publication audit without copying raw messages into samples', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publication-audit-'));
  try {
    const rawFile = path.join(root, 'raw.jsonl');
    const shard = path.join(root, 'shard-01');
    const output = path.join(root, 'output');
    fs.mkdirSync(shard);
    const wtb = sourceRecord({ id: '1', type: 'search', title: 'Patek 5712/1A blue', brand: 'Patek Philippe', reference: '5712/1A' });
    const wts = sourceRecord({ id: '2', type: 'sale', title: 'Rolex 116500LN white USD 28000', brand: 'Rolex', reference: '116500LN' });
    fs.writeFileSync(rawFile, `${jsonLine(wtb)}${jsonLine(wts)}`);
    const rows = [
      normalized(wtb, { brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTB', dial_color: 'Blue', prices: [] }),
      normalized(wts, {
        brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White',
        prices: [{ is_primary: true, amount_original: 28000, amount_usd: 28000, currency_original: 'USD', currency_evidence: 'explicit_line_currency' }],
      }),
    ];
    fs.writeFileSync(path.join(shard, 'normalization-proposals.jsonl'), rows.map(jsonLine).join(''));
    const manifest = {
      source_rows: 2, difference: 0, source_coverage_reconciled: true,
      totals: { error_rows: 0 }, segments: [{ directory: shard }],
    };
    const manifestFile = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const report = await run({ env: {
      MARIADB_PUBLICATION_RAW_INPUT: rawFile,
      MARIADB_PUBLICATION_NORMALIZATION_MANIFEST: manifestFile,
      MARIADB_PUBLICATION_AUDIT_OUTPUT: output,
      MARIADB_PUBLICATION_SAMPLE_LIMIT: '2',
    } });
    assert.equal(report.source_rows, 2);
    assert.equal(report.reconciled, true);
    assert.equal(report.counts.intent.WTB, 1);
    assert.equal(report.counts.intent.WTS, 1);
    assert.equal(report.counts.price_research_status.DEMAND_PENDING_HUMAN_APPROVAL, 1);
    assert.equal(report.counts.price_research_status.SALE_PENDING_HUMAN_APPROVAL, 1);
    const samples = fs.readFileSync(path.join(output, 'publication-readiness-samples.jsonl'), 'utf8');
    assert.doesNotMatch(samples, /raw_message"/);
    assert.match(samples, /raw_evidence_ref/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a manifest with normalization errors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publication-errors-'));
  try {
    const rawFile = path.join(root, 'raw.jsonl');
    const manifestFile = path.join(root, 'manifest.json');
    fs.writeFileSync(rawFile, '');
    fs.writeFileSync(manifestFile, JSON.stringify({ source_coverage_reconciled: true, difference: 0, totals: { error_rows: 1 } }));
    await assert.rejects(() => run({ env: {
      MARIADB_PUBLICATION_RAW_INPUT: rawFile,
      MARIADB_PUBLICATION_NORMALIZATION_MANIFEST: manifestFile,
      MARIADB_PUBLICATION_AUDIT_OUTPUT: path.join(root, 'output'),
    } }), /refuses normalization errors/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
