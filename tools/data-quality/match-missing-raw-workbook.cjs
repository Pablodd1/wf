'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const WORKBOOK_PATH = process.env.MISSING_RAW_WORKBOOK || '';
const EVIDENCE_PATH = process.env.MISSING_RAW_EVIDENCE_JSONL || '';
const OUTPUT_DIR = process.env.MISSING_RAW_WORKBOOK_OUTPUT_DIR || path.dirname(EVIDENCE_PATH);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedReference(value) {
  return normalized(value).replace(/[^a-z0-9]/g, '');
}

function timestampSecond(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : '';
}

function numeric(value) {
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function agreement(record, source) {
  const checks = {
    reference: Boolean(
      normalizedReference(record.reference)
      && normalizedReference(record.reference) === normalizedReference(source.reference)
    ),
    dial: Boolean(normalized(record.dial_color) && normalized(record.dial_color) === normalized(source.dial)),
    condition: Boolean(normalized(record.condition) && normalized(record.condition) === normalized(source.condition)),
    price: Boolean(
      numeric(record.price_raw ?? record.price_usd)
      && numeric(record.price_raw ?? record.price_usd) === numeric(source.price)
    ),
  };
  return {
    checks,
    count: Object.values(checks).filter(Boolean).length,
  };
}

function classifyWorkbookMatch(record, rows) {
  const sourceRows = rows.filter(row => normalized(row.raw_message));
  const timestamp = timestampSecond(record.created_at);
  const timestampMatches = timestamp
    ? sourceRows.filter(row => timestampSecond(row.created_at) === timestamp)
    : [];
  if (timestampMatches.length === 1) {
    const support = agreement(record, timestampMatches[0]);
    return {
      disposition: support.count >= 1 ? 'HIGH_CONFIDENCE_REVIEW' : 'REVIEW_CANDIDATE',
      reason: support.count >= 1 ? 'UNIQUE_TIMESTAMP_WITH_FIELD_AGREEMENT' : 'UNIQUE_TIMESTAMP_ONLY',
      support,
      matches: timestampMatches,
    };
  }
  if (timestampMatches.length > 1) {
    return {
      disposition: 'AMBIGUOUS',
      reason: 'DUPLICATE_SOURCE_TIMESTAMP',
      matches: timestampMatches,
    };
  }

  const fieldMatches = sourceRows.filter(row => {
    const support = agreement(record, row);
    return support.checks.reference && support.count >= 2;
  });
  if (fieldMatches.length === 1) {
    return {
      disposition: 'REVIEW_CANDIDATE',
      reason: 'UNIQUE_REFERENCE_PLUS_FIELD_MATCH',
      support: agreement(record, fieldMatches[0]),
      matches: fieldMatches,
    };
  }
  return {
    disposition: fieldMatches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED',
    reason: fieldMatches.length > 1 ? 'MULTIPLE_FIELD_MATCHES' : 'NO_UNIQUE_WORKBOOK_MATCH',
    matches: fieldMatches,
  };
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(fileName, rows) {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, fileName),
    rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
    'utf8',
  );
}

function safeSourceRow(sheetName, rowNumber, row) {
  return {
    sheet: sheetName,
    row_number: rowNumber,
    brand: row.brand,
    reference: row.reference,
    price: row.price,
    dial: row.dial,
    condition: row.condition,
    watch_year: row['YEAR (watch)'],
    posted_month: row['MONTH (posted)'],
    raw_message: row.raw_message,
    created_at: row.created_at,
    dealer: row.dealer,
    region: row.region,
    model: row.model,
    jass_score: row.JASS_SCORE,
    jass_verdict: row.JASS_VERDICT,
    original_row: row.ORIGINAL_ROW,
  };
}

async function main() {
  if (!WORKBOOK_PATH || !fs.existsSync(WORKBOOK_PATH)) throw new Error('MISSING_RAW_WORKBOOK is required');
  if (!EVIDENCE_PATH || !fs.existsSync(EVIDENCE_PATH)) throw new Error('MISSING_RAW_EVIDENCE_JSONL is required');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const evidence = readJsonl(EVIDENCE_PATH);
  const brands = [...new Set(evidence.map(item => String(item.record?.brand || '').trim()).filter(Boolean))];
  const workbookHash = sha256File(WORKBOOK_PATH);
  const workbook = XLSX.readFile(WORKBOOK_PATH, {
    sheets: brands,
    cellDates: false,
    dense: true,
  });
  const rowsByBrand = new Map();
  let workbookRowsScanned = 0;
  for (const brand of brands) {
    const sheet = workbook.Sheets[brand];
    if (!sheet) throw new Error(`Workbook sheet missing for ${brand}`);
    const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null })
      .map((row, index) => safeSourceRow(brand, index + 2, row));
    workbookRowsScanned += rows.length;
    rowsByBrand.set(normalized(brand), rows);
  }

  const results = evidence.map(item => {
    const record = item.record;
    const match = classifyWorkbookMatch(record, rowsByBrand.get(normalized(record.brand)) || []);
    return {
      record_id: record.id,
      record_snapshot: {
        brand: record.brand,
        reference: record.reference,
        price_raw: record.price_raw,
        price_usd: record.price_usd,
        currency: record.currency,
        dial_color: record.dial_color,
        condition: record.condition,
        created_at: record.created_at,
        listing_date: record.listing_date,
        source: record.source,
      },
      ...match,
    };
  });

  const buckets = {
    HIGH_CONFIDENCE_REVIEW: results.filter(row => row.disposition === 'HIGH_CONFIDENCE_REVIEW'),
    REVIEW_CANDIDATE: results.filter(row => row.disposition === 'REVIEW_CANDIDATE'),
    AMBIGUOUS: results.filter(row => row.disposition === 'AMBIGUOUS'),
    UNRESOLVED: results.filter(row => row.disposition === 'UNRESOLVED'),
  };
  const equation = `${results.length} = ${buckets.HIGH_CONFIDENCE_REVIEW.length} + ${buckets.REVIEW_CANDIDATE.length} + ${buckets.AMBIGUOUS.length} + ${buckets.UNRESOLVED.length}`;
  if (results.length !== Object.values(buckets).reduce((sum, rows) => sum + rows.length, 0)) {
    throw new Error(`Workbook match results did not reconcile: ${equation}`);
  }

  const generatedAt = new Date().toISOString();
  writeJson('workbook-match-summary.json', {
    generated_at: generatedAt,
    accepted: true,
    read_only: true,
    database_writes: 0,
    watch_records_writes: 0,
    source_workbook: {
      path: path.resolve(WORKBOOK_PATH),
      bytes: fs.statSync(WORKBOOK_PATH).size,
      sha256: await workbookHash,
      sheets_scanned: brands,
      rows_scanned: workbookRowsScanned,
    },
    input_records: results.length,
    high_confidence_review: buckets.HIGH_CONFIDENCE_REVIEW.length,
    review_candidates: buckets.REVIEW_CANDIDATE.length,
    ambiguous: buckets.AMBIGUOUS.length,
    unresolved: buckets.UNRESOLVED.length,
    recovered_exact: 0,
    equation,
    decision: 'Workbook rows have no database UUID. Matches are review candidates only; no automatic repair is permitted.',
  });
  writeJsonl('workbook-high-confidence.private.jsonl', buckets.HIGH_CONFIDENCE_REVIEW);
  writeJsonl('workbook-review-candidates.private.jsonl', buckets.REVIEW_CANDIDATE);
  writeJsonl('workbook-ambiguous.private.jsonl', buckets.AMBIGUOUS);
  writeJsonl('workbook-unresolved.private.jsonl', buckets.UNRESOLVED);

  process.stdout.write(`${JSON.stringify({
    event: 'missing_raw_workbook_match_complete',
    accepted: true,
    input: results.length,
    high_confidence_review: buckets.HIGH_CONFIDENCE_REVIEW.length,
    review_candidates: buckets.REVIEW_CANDIDATE.length,
    ambiguous: buckets.AMBIGUOUS.length,
    unresolved: buckets.UNRESOLVED.length,
    recovered_exact: 0,
    equation,
    database_writes: 0,
  })}\n`);
}

module.exports = {
  agreement,
  classifyWorkbookMatch,
  timestampSecond,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
