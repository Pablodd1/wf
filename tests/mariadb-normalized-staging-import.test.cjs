'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  STAGING_CONTRACT,
  assertSafeTransport,
  run,
  stagingRecord,
  submitBatch,
} = require('../tools/mariadb-live/import-normalized-staging.cjs');
const { jsonLine, sourceRecord } = require('../tools/mariadb-live/lib.cjs');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260811120000_mariadb_normalized_staging_import.sql'),
  'utf8',
);

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

test('single WTS is staged with exact hashes but without duplicated raw or private contact data', () => {
  const source = sourceRecord({
    id: 'wts-1', created_on: '2026-08-01 10:00:00', type: 'sale',
    title: 'Rolex 116500LN white USD 28000', from_name: 'Source Seller',
    from_number: '+15550000000', dealer_rating: '5.0', region: 'New York',
  });
  const row = stagingRecord(source, proposal(source, {
    brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White',
    prices: [{
      is_primary: true, amount_original: 28000, amount_usd: 28000,
      currency_original: 'USD', raw_price_text: 'USD 28000', currency_evidence: 'explicit_line_currency',
    }],
  }));

  assert.equal(row.contract, STAGING_CONTRACT);
  assert.equal(row.materialization, 'SINGLE');
  assert.equal(row.source_hash, source.raw_sha256);
  assert.equal(row.candidate.price.amount_usd, 28000);
  assert.equal(row.public_image_eligible, false);
  assert.equal(row.contact_publication_approved, false);
  assert.equal(row.seller_public.name, 'Source Seller');
  assert.equal(row.seller_public.location, 'New York');
  assert.equal(row.seller_public.rating, null);
  assert.equal(Object.hasOwn(row, 'raw_message'), false);
  assert.equal(JSON.stringify(row).includes('+15550000000'), false);
  assert.equal(JSON.stringify(row).includes('"dealer_rating"'), false);
  assert.equal(assertSafeTransport(row), row);
});

test('WTB with no supplied price remains a single Trading Floor demand candidate', () => {
  const source = sourceRecord({ id: 'wtb-1', type: 'search', title: 'WTB Patek 5712/1A blue' });
  const row = stagingRecord(source, proposal(source, {
    brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTB', dial_color: 'Blue', prices: [],
  }));
  assert.equal(row.materialization, 'SINGLE');
  assert.equal(row.candidate.listing_type, 'WTB');
  assert.equal(row.candidate.price, null);
  assert.equal(row.price_research_status, 'DEMAND_PENDING_HUMAN_APPROVAL');
});

test('bundle parents and their children are deferred from materialization', () => {
  const source = sourceRecord({ id: 'bundle-1', type: 'sale', is_bundle: 1, title: 'Rolex 116500LN USD 28000 / Patek 5712 USD 90000' });
  const row = stagingRecord(source, proposal(source, {
    brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White', prices: [],
  }, { bundle_status: 'BUNDLE_SPLIT_REQUIRED', review_disposition: 'HUMAN_REVIEW' }));
  assert.equal(row.materialization, 'DEFERRED');
  assert.equal(row.public_image_eligible, false);
});

test('strong non-watch item is staged for Trading Floor but not watch Price Research', () => {
  const source = sourceRecord({ id: 'bag-1', type: 'sale', title: 'WTS Hermes Birkin 30 bag USD 24000' });
  const row = stagingRecord(source, proposal(source, null, {
    catalog_confirmation: { confirmed: false },
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['NON_WATCH_CATEGORY'],
  }));
  assert.equal(row.materialization, 'SINGLE');
  assert.equal(row.category, 'HANDBAG');
  assert.equal(row.price_research_status, 'INELIGIBLE_NON_WATCH');
});

test('batch transport is idempotently tokened and exactly reconciled', async () => {
  const source = sourceRecord({ id: 'one', type: 'search', title: 'WTB Patek 5712/1A blue' });
  const record = stagingRecord(source, proposal(source, {
    brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTB', dial_color: 'Blue', prices: [],
  }));
  let request;
  const result = await submitBatch({
    baseUrl: 'https://example.supabase.co', key: 'masked', runKey: 'normalized-canary',
    rawImportRunKey: 'raw-canary',
  }, {
    input_rows: 0,
    input_fingerprint: 'a'.repeat(64),
  }, [record], async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        input_rows: 1, staged_rows: 1, existing_rows: 0, deferred_rows: 0,
        error_rows: 0, next_input_rows: 1, publication_writes: 0,
      }),
    };
  });
  assert.equal(result.staged_rows, 1);
  assert.match(request.url, /rpc\/ingest_mariadb_normalization_batch$/);
  const body = JSON.parse(request.options.body);
  assert.equal(body.p_records.length, 1);
  assert.equal(body.p_records[0].source_record_id, source.source_record_id);
  assert.equal(Object.hasOwn(body.p_records[0], 'raw_message'), false);
});

test('full staging run streams raw and proposals in lockstep and reconciles completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalized-staging-run-'));
  try {
    const rawInput = path.join(root, 'raw.jsonl');
    const segment = path.join(root, 'segment');
    const output = path.join(root, 'output');
    fs.mkdirSync(segment);
    const sources = [
      sourceRecord({ id: '1', type: 'sale', title: 'Rolex 116500LN white USD 28000' }),
      sourceRecord({ id: '2', type: 'sale', is_bundle: 1, title: 'Rolex 116500LN USD 28000 / Patek 5712 USD 90000' }),
      sourceRecord({ id: '3', type: 'sale', title: 'WTS Hermes Birkin 30 bag USD 24000' }),
    ];
    const proposals = [
      proposal(sources[0], {
        brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White',
        prices: [{ is_primary: true, amount_original: 28000, amount_usd: 28000, currency_original: 'USD', currency_evidence: 'explicit_line_currency' }],
      }),
      proposal(sources[1], {
        brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'White', prices: [],
      }, { bundle_status: 'BUNDLE_SPLIT_REQUIRED', review_disposition: 'HUMAN_REVIEW' }),
      proposal(sources[2], null, {
        catalog_confirmation: { confirmed: false }, review_disposition: 'HUMAN_REVIEW', review_reasons: ['NON_WATCH_CATEGORY'],
      }),
    ];
    fs.writeFileSync(rawInput, sources.map(jsonLine).join(''));
    fs.writeFileSync(path.join(segment, 'normalization-proposals.jsonl'), proposals.map(jsonLine).join(''));
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      source_rows: 3,
      difference: 0,
      source_coverage_reconciled: true,
      totals: { error_rows: 0 },
      segments: [{ directory: segment }],
    }));

    const requests = [];
    const report = await run({
      config: {
        baseUrl: 'https://example.supabase.co', key: 'masked', rawInput, manifestPath,
        rawImportRunKey: 'raw-complete', runKey: 'normalized-canary', batchSize: 10, output,
      },
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        if (url.endsWith('/ingest_mariadb_normalization_batch')) {
          const deferred = body.p_records.filter(row => row.materialization === 'DEFERRED').length;
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify({
              input_rows: body.p_records.length,
              staged_rows: body.p_records.length - deferred,
              existing_rows: 0,
              deferred_rows: deferred,
              error_rows: 0,
              next_input_rows: body.p_next_input_rows,
              publication_writes: 0,
            }),
          };
        }
        assert.ok(url.endsWith('/complete_mariadb_normalization_import'));
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'NORMALIZATION_STAGED' }) };
      },
    });

    assert.equal(report.reconciled, true);
    assert.equal(report.input_rows, 3);
    assert.equal(report.staged_rows, 2);
    assert.equal(report.deferred_rows, 1);
    assert.equal(report.publication_writes, 0);
    assert.equal(requests.length, 2);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(output, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded canary checkpoints safely without declaring the full import complete', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalized-staging-canary-'));
  try {
    const rawInput = path.join(root, 'raw.jsonl');
    const segment = path.join(root, 'segment');
    const output = path.join(root, 'output');
    fs.mkdirSync(segment);
    const sources = [
      sourceRecord({ id: '1', type: 'sale', title: 'Rolex 116500LN white USD 28000' }),
      sourceRecord({ id: '2', type: 'search', title: 'WTB Patek 5712/1A blue' }),
      sourceRecord({ id: '3', type: 'sale', title: 'Rolex 126500LN black USD 30000' }),
    ];
    const proposals = sources.map((source, index) => proposal(source, {
      brand: index === 1 ? 'Patek Philippe' : 'Rolex',
      reference: index === 1 ? '5712/1A' : index === 0 ? '116500LN' : '126500LN',
      listing_type: index === 1 ? 'WTB' : 'WTS',
      dial_color: index === 1 ? 'Blue' : index === 0 ? 'White' : 'Black',
      prices: index === 1 ? [] : [{
        is_primary: true,
        amount_original: index === 0 ? 28000 : 30000,
        amount_usd: index === 0 ? 28000 : 30000,
        currency_original: 'USD',
        currency_evidence: 'explicit_line_currency',
      }],
    }));
    fs.writeFileSync(rawInput, sources.map(jsonLine).join(''));
    fs.writeFileSync(path.join(segment, 'normalization-proposals.jsonl'), proposals.map(jsonLine).join(''));
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      source_rows: 3,
      difference: 0,
      source_coverage_reconciled: true,
      totals: { error_rows: 0 },
      segments: [{ directory: segment }],
    }));

    const requests = [];
    const report = await run({
      config: {
        baseUrl: 'https://example.supabase.co', key: 'masked', rawInput, manifestPath,
        rawImportRunKey: 'raw-complete', runKey: 'normalized-canary', batchSize: 10,
        maxRows: 2, output,
      },
      fetchImpl: async (url, options) => {
        requests.push(url);
        assert.ok(url.endsWith('/ingest_mariadb_normalization_batch'));
        const body = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            input_rows: body.p_records.length,
            staged_rows: body.p_records.length,
            existing_rows: 0,
            deferred_rows: 0,
            error_rows: 0,
            next_input_rows: body.p_next_input_rows,
            publication_writes: 0,
          }),
        };
      },
    });

    assert.equal(report.partial, true);
    assert.equal(report.complete, false);
    assert.equal(report.reconciled, true);
    assert.equal(report.input_rows, 2);
    assert.equal(report.publication_writes, 0);
    assert.equal(requests.length, 1);
    assert.doesNotMatch(requests[0], /complete_mariadb_normalization_import/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging migration is private, lineage-bound, bundle-safe, and non-publishing', () => {
  assert.match(migration, /raw_message_version_id UUID REFERENCES public\.raw_message_versions/);
  assert.match(migration, /source_hash TEXT/);
  assert.match(migration, /source_candidate_hash TEXT/);
  assert.match(migration, /status = 'RAW_COPY_COMPLETE'/);
  assert.match(migration, /v_record->>'materialization' = 'DEFERRED'/);
  assert.match(migration, /attempts to materialize a bundle/);
  assert.match(migration, /public_image_eligible[^\n]*false/);
  assert.match(migration, /rating, dealer_rating, contact_consent/);
  assert.match(migration, /NULL, NULL, false/);
  assert.match(migration, /publication_writes', 0/);
  assert.match(migration, /REVOKE ALL[^;]+FROM PUBLIC, anon, authenticated/s);
  assert.doesNotMatch(migration, /INSERT INTO public\.watch_records/i);
  assert.doesNotMatch(migration, /GRANT SELECT[^;]+TO anon/i);
});

test('unsafe staging transport is rejected before network submission', () => {
  assert.throws(() => assertSafeTransport({
    raw_message: 'private raw evidence', public_image_eligible: false, contact_publication_approved: false,
  }), /prohibited field/);
  assert.throws(() => assertSafeTransport({
    public_image_eligible: true, contact_publication_approved: false,
  }), /bypass image or contact review/);
});
