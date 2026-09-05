'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  classifySafePair,
  imageLineage,
  mapListingType,
  normalizePhone,
  normalizeSourceRow,
  runIntake,
} = require('../tools/intake/normalize-watches-only-report.cjs');

function sourceRow(overrides = {}) {
  return {
    id: 'source-1',
    category_id: '',
    category_name: '',
    origin: 'WhatsApp',
    type: 'sale',
    from_name: 'Dealer',
    phone_code: '+852',
    from_number: '6016 1840',
    raw_message: 'Rolex 116500LN White HKD 283K WTS',
    full_description: '',
    brand: 'Rolex',
    model: '116500LN',
    price: '283000',
    currency: 'HKD',
    usd_price: '36282',
    date_time: 'abc_front_image.jpg',
    id_tag: 'https://cdn.example/listings/full/abc_front_image.jpg',
    front_image: '',
    full_image_url: '',
    ...overrides,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeSourceCsv(filePath, rows) {
  const headers = Object.keys(sourceRow());
  fs.writeFileSync(filePath, [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n'));
}

test('maps source listing types and normalized phone deterministically', () => {
  assert.equal(mapListingType('sale'), 'WTS');
  assert.equal(mapListingType('search'), 'WTB');
  assert.equal(mapListingType('other'), null);
  assert.equal(normalizePhone('+852', '6016 1840'), '85260161840');
});

test('recovers image lineage from the export-shifted date and id-tag columns', () => {
  const image = imageLineage(sourceRow());
  assert.equal(image.image_key, 'abc_front_image.jpg');
  assert.equal(image.public_url, 'https://cdn.example/listings/full/abc_front_image.jpg');
  assert.equal(image.basename_matches, true);
  assert.equal(image.status, 'SOURCE_LINKED_PENDING_VISUAL_REVIEW');
  assert.deepEqual(image.source_columns, ['date_time', 'id_tag']);
});

test('rejects the Telegram /0 image placeholder', () => {
  const image = imageLineage(sourceRow({
    origin: 'Telegram',
    date_time: '0',
    id_tag: 'https://cdn.example/listings/full/0',
  }));
  assert.equal(image.public_url, null);
  assert.equal(image.status, 'INVALID_IMAGE_PLACEHOLDER');
});

test('normalizes explicit raw currency but never approves or publishes contact', () => {
  const row = normalizeSourceRow(sourceRow(), 1);
  assert.equal(row.source_record_id, 'source-1');
  assert.equal(row.source_listing_type, 'WTS');
  assert.equal(row.normalized_currency, 'HKD');
  assert.equal(row.currency_evidence, 'explicit_line_currency');
  assert.equal(row.seller.phone_normalized, '85260161840');
  assert.equal(row.seller.contact_consent, false);
  assert.equal(row.seller.public_contact_eligible, false);
  assert.equal(row.production_approved, false);
});

test('holds a bare-dollar structured-currency row for review', () => {
  const row = normalizeSourceRow(sourceRow({
    raw_message: 'Rolex 116500LN White $28K WTS',
    price: '28000',
    currency: 'USD',
    usd_price: '28000',
  }), 1);
  assert.ok(row.blockers.includes('CURRENCY_EVIDENCE_INSUFFICIENT'));
  assert.notEqual(row.disposition, 'READY_FOR_HUMAN_APPROVAL');
});

test('never auto-suppresses in-file matches with separate image evidence', () => {
  const canonical = {
    raw_message: 'Rolex 116500LN White 5/2025 HKD 283K WTS',
    brand: 'Rolex',
    reference: '116500LN',
    dial_color: 'White',
    condition: 'Used',
    listing_type: 'WTS',
    seller_phone: '85260161840',
    price_usd: 36282,
  };
  const dateShifted = {
    ...canonical,
    raw_message: 'Rolex 116500LN White 6/2026 HKD 283K WTS',
  };
  const exactListing = {
    ...canonical,
    raw_message: 'Different source evidence for the same configuration',
  };
  const exactRaw = { ...canonical };
  assert.equal(classifySafePair(canonical, dateShifted).type, 'DATE_SHIFTED_REPOST');
  assert.equal(classifySafePair(canonical, dateShifted).suppressFromAnalytics, false);
  assert.equal(classifySafePair(canonical, exactListing).type, 'EXACT_LISTING');
  assert.equal(classifySafePair(canonical, exactListing).suppressFromAnalytics, false);
  assert.equal(classifySafePair(canonical, exactRaw).type, 'EXACT_RAW_MESSAGE');
  assert.equal(classifySafePair(canonical, exactRaw).suppressFromAnalytics, false);
});

test('does not collapse identity-poor rows that only share seller and price', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-watches-identity-poor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.csv');
  const output = path.join(directory, 'output');
  writeSourceCsv(source, [
    sourceRow({
      id: 'poor-1',
      raw_message: 'Beautiful watch USD 10K',
      brand: '',
      model: '',
      price: '10000',
      currency: 'USD',
      usd_price: '10000',
    }),
    sourceRow({
      id: 'poor-2',
      raw_message: 'Another watch USD 10K',
      brand: '',
      model: '',
      price: '10000',
      currency: 'USD',
      usd_price: '10000',
    }),
  ]);
  const result = await runIntake({
    sourcePath: source,
    outputDir: output,
    verifyImages: false,
  });
  assert.equal(result.coverage.duplicate.UNIQUE_IN_CHECKED_BASELINES, 2);
  assert.equal(result.coverage.duplicate.DUPLICATE_SUPPRESSED, undefined);
});

test('reconciles every row and suppresses a same-seller exact baseline duplicate', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-watches-only-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.csv');
  const baseline = path.join(directory, 'baseline.csv');
  const output = path.join(directory, 'output');
  writeSourceCsv(source, [
    sourceRow(),
    sourceRow({
      id: 'source-2',
      raw_message: 'Patek Philippe 5712/1A USD 110K WTS',
      brand: 'Patek Philippe',
      model: '5712/1A',
      price: '110000',
      currency: 'USD',
      usd_price: '110000',
      date_time: 'patek.jpg',
      id_tag: 'https://cdn.example/listings/full/patek.jpg',
    }),
  ]);
  fs.writeFileSync(baseline, [
    'id,raw_message,brand,reference,dial_color,condition,price_usd,currency,source,listing_type',
    'existing-1,[7/1/2026] +852 6016 1840: Rolex 116500LN White HKD 283K WTS,Rolex,116500LN,White,,36282,HKD,archive,WTS',
  ].join('\n'));

  const result = await runIntake({
    sourcePath: source,
    baselinePath: baseline,
    outputDir: output,
    verifyImages: false,
  });
  assert.equal(result.reconciliation.input_rows, 2);
  assert.equal(result.reconciliation.normalized_rows, 2);
  assert.equal(result.reconciliation.error_rows, 0);
  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.coverage.duplicate.DUPLICATE_SUPPRESSED, 1);
  assert.equal(result.coverage.not_auto_suppressed, 1);
  assert.equal(result.coverage.eligible_after_duplicate_gate, 1);

  const redacted = fs.readFileSync(path.join(output, 'review-queue.redacted.csv'), 'utf8');
  assert.doesNotMatch(redacted, /85260161840/);
  assert.doesNotMatch(redacted, /,Dealer,/);
  const privateSeller = fs.readFileSync(path.join(output, 'seller-lineage.private.csv'), 'utf8');
  assert.match(privateSeller, /85260161840/);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.safety.production_writes, 0);
  assert.equal(manifest.safety.images_attached_to_listings, 0);
});
