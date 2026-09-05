'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const csvParser = require('csv-parser');

const SOURCE_EXPORT = process.env.SOURCE_EXPORT_CSV || '';
const EXISTING_IDS_CSV = process.env.MISSING_RAW_IDS_CSV || '';
const OUTPUT_DIR = process.env.MISSING_RAW_OUTPUT_DIR
  || path.resolve('audit-output', `missing-raw-gap-${new Date().toISOString().replace(/[:.]/g, '')}`);
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const MISSING_COLUMNS = [
  'id', 'brand', 'model', 'reference', 'price_raw', 'price_usd', 'currency',
  'dial_color', 'condition', 'year', 'listing_type', 'source', 'source_type',
  'created_at', 'listing_date', 'seller_name', 'region', 'thumbnail_url', 'flags',
].join(',');

function sourceIdentity(recordId) {
  const value = String(recordId || '').trim();
  const match = value.match(/^mysql_auction_watches_([0-9a-f-]{36})$/i);
  if (match) return match[1].toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : '';
}

function imageFilename(value) {
  const pathname = String(value || '').split('?')[0].replaceAll('\\', '/');
  return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)).toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(fileName, columns, rows) {
  const lines = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ];
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${lines.join('\n')}\n`, 'utf8');
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

async function rest(table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(`Supabase ${response.status} reading ${table}: ${detail}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${table} returned a non-array response`);
  return rows;
}

async function globalCounts() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/global_data_quality_blocker_counts`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(`Supabase ${response.status} reading exact blocker counts: ${detail}`);
  }
  const result = await response.json();
  const total = Number(result?.watch_records?.total);
  const eligible = Number(result?.normalization?.total_normalized);
  if (
    result?.exact !== true
    || !Number.isSafeInteger(total)
    || !Number.isSafeInteger(eligible)
  ) {
    throw new Error('Authoritative watch-record or normalization count is unavailable');
  }
  return { total, eligible, generated_at: result.generated_at };
}

async function fetchPartitionedMissingRows() {
  const base = 'mysql_auction_watches_';
  const mysqlPartitions = Array.from({ length: 256 }, (_, index) => {
    const start = `${base}${index.toString(16).padStart(2, '0')}`;
    const end = index < 255
      ? `${base}${(index + 1).toString(16).padStart(2, '0')}`
      : `${base}g`;
    return { label: `${start}..${end}`, and: `(id.gte.${start},id.lt.${end})` };
  });
  const uuidPartitions = Array.from({ length: 256 }, (_, index) => {
    const start = index.toString(16).padStart(2, '0');
    const end = index < 255
      ? (index + 1).toString(16).padStart(2, '0')
      : 'fg';
    return { label: `uuid:${start}..${end}`, and: `(id.gte.${start},id.lt.${end})` };
  });
  const partitions = [...uuidPartitions, ...mysqlPartitions];
  partitions.push(
    {
      label: 'media_other_..media_other_g',
      and: '(id.gte.media_other_,id.lt.media_other_g)',
    },
    {
      label: 'list_..list_a',
      and: '(id.gte.list_,id.lt.list_a)',
    },
  );

  const rows = [];
  let cursor = 0;
  async function worker() {
    while (cursor < partitions.length) {
      const partition = partitions[cursor];
      cursor += 1;
      let page;
      try {
        const { label, ...filters } = partition;
        page = await rest('watch_records', {
          select: MISSING_COLUMNS,
          raw_message: 'is.null',
          order: 'id.asc',
          limit: '1000',
          ...filters,
        });
      } catch (error) {
        throw new Error(`${partition.label}: ${error.message}`);
      }
      if (page.length >= 1000) throw new Error('Missing-raw partition exceeded its bounded page');
      rows.push(...page);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  rows.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const unique = new Set(rows.map(row => row.id));
  if (unique.size !== rows.length) throw new Error('Missing-raw partition scan returned duplicate ids');
  return rows;
}

async function verifyMissingRows(ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const page = await rest('watch_records', {
      select: MISSING_COLUMNS,
      raw_message: 'is.null',
      order: 'id.asc',
      id: `in.(${chunk.map(id => `"${id.replaceAll('"', '')}"`).join(',')})`,
      limit: '100',
    });
    rows.push(...page);
  }
  return rows;
}

async function fetchRawMessages(ids) {
  const found = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const filter = `in.(${chunk.map(id => `"${id.replaceAll('"', '')}"`).join(',')})`;
    const rows = await rest('raw_messages', {
      select: 'id,external_message_id,source_platform,received_at,raw_text',
      id: filter,
      limit: '100',
    });
    for (const row of rows) found.set(String(row.id), row);
  }
  return found;
}

function scanSourceExport(filePath, missingRows) {
  const bySourceId = new Map();
  const byImage = new Map();
  for (const row of missingRows) {
    const sourceId = sourceIdentity(row.id);
    if (sourceId) bySourceId.set(sourceId, row.id);
    const image = imageFilename(row.thumbnail_url);
    if (image) {
      const records = byImage.get(image) || [];
      records.push(row.id);
      byImage.set(image, records);
    }
  }

  return new Promise((resolve, reject) => {
    const matches = new Map();
    const fileHash = crypto.createHash('sha256');
    let rowsScanned = 0;
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => fileHash.update(chunk));
    input.on('error', reject);
    input
      .pipe(csvParser())
      .on('data', source => {
        rowsScanned += 1;
        const sourceId = String(source.id || '').trim().toLowerCase();
        const frontImage = imageFilename(source.front_image);
        const destinations = new Map();
        if (sourceId && bySourceId.has(sourceId)) {
          destinations.set(bySourceId.get(sourceId), 'SOURCE_ID_EXACT');
        }
        for (const recordId of byImage.get(frontImage) || []) {
          if (!destinations.has(recordId)) destinations.set(recordId, 'FRONT_IMAGE_EXACT');
        }
        for (const [recordId, matchMode] of destinations) {
          const recordMatches = matches.get(recordId) || [];
          recordMatches.push({
            match_mode: matchMode,
            source_row_sha256: sha256(JSON.stringify(source)),
            source,
          });
          matches.set(recordId, recordMatches);
        }
      })
      .on('error', reject)
      .on('end', () => resolve({
        fileSha256: fileHash.digest('hex'),
        rowsScanned,
        matches,
      }));
  });
}

function readIdsCsv(filePath) {
  return new Promise((resolve, reject) => {
    const ids = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', row => {
        const id = String(row.id || row.record_id || '').trim();
        if (id) ids.push(id);
      })
      .on('error', reject)
      .on('end', () => resolve(ids));
  });
}

function classifyDisposition(record, rawById, sourceMatches) {
  const rawMessageId = typeof record.flags?.raw_message_id === 'string'
    ? record.flags.raw_message_id
    : '';
  const immutable = rawById.get(rawMessageId);
  if (immutable?.raw_text) {
    return {
      disposition: 'RECOVERED_EXACT',
      evidence_source: 'IMMUTABLE_RAW_MESSAGES',
      raw_message_id: rawMessageId,
      immutable,
    };
  }

  const matches = sourceMatches.get(record.id) || [];
  const sourceIdMatches = matches.filter(match => match.match_mode === 'SOURCE_ID_EXACT');
  if (sourceIdMatches.length === 1) {
    return {
      disposition: 'RECOVERED_EXACT',
      evidence_source: 'SOURCE_EXPORT_ID_EXACT',
      match: sourceIdMatches[0],
    };
  }
  if (matches.length > 0) {
    return {
      disposition: 'REVIEW_CANDIDATE',
      evidence_source: sourceIdMatches.length > 1 ? 'AMBIGUOUS_SOURCE_ID' : 'FRONT_IMAGE_ONLY',
      matches,
    };
  }
  return {
    disposition: 'UNRESOLVED',
    evidence_source: rawMessageId ? 'RAW_MESSAGE_POINTER_NOT_FOUND' : 'NO_EXACT_SOURCE_EVIDENCE',
  };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase read credentials are required');
  if (!SOURCE_EXPORT || !fs.existsSync(SOURCE_EXPORT)) throw new Error('SOURCE_EXPORT_CSV must name the original source export');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const beforeCounts = await globalCounts();
  const suppliedIds = EXISTING_IDS_CSV ? await readIdsCsv(EXISTING_IDS_CSV) : [];
  const firstMissingScan = suppliedIds.length
    ? await verifyMissingRows(suppliedIds)
    : await fetchPartitionedMissingRows();
  const secondMissingScan = await verifyMissingRows(firstMissingScan.map(row => row.id));
  const afterCounts = await globalCounts();
  const firstHash = sha256(firstMissingScan.map(row => `${row.id}\n`).join(''));
  const secondHash = sha256(secondMissingScan.map(row => `${row.id}\n`).join(''));
  const expectedGap = beforeCounts.total - beforeCounts.eligible;
  if (
    beforeCounts.total !== afterCounts.total
    || beforeCounts.eligible !== afterCounts.eligible
    || firstMissingScan.length !== expectedGap
    || firstMissingScan.length !== secondMissingScan.length
    || firstHash !== secondHash
  ) {
    throw new Error(`Missing-raw database snapshot did not reconcile: expected ${expectedGap}, found ${firstMissingScan.length}`);
  }
  const total = beforeCounts.total;
  const missing = firstMissingScan;
  const eligible = beforeCounts.eligible;

  const rawMessageIds = [...new Set(missing
    .map(row => typeof row.flags?.raw_message_id === 'string' ? row.flags.raw_message_id : '')
    .filter(Boolean))];
  const [rawById, sourceScan] = await Promise.all([
    fetchRawMessages(rawMessageIds),
    scanSourceExport(SOURCE_EXPORT, missing),
  ]);

  const dispositions = missing.map(record => ({
    record,
    result: classifyDisposition(record, rawById, sourceScan.matches),
  }));
  const recovered = dispositions.filter(item => item.result.disposition === 'RECOVERED_EXACT');
  const review = dispositions.filter(item => item.result.disposition === 'REVIEW_CANDIDATE');
  const unresolved = dispositions.filter(item => item.result.disposition === 'UNRESOLVED');

  const equation = `${missing.length} = ${recovered.length} + ${review.length} + ${unresolved.length}`;
  if (missing.length !== recovered.length + review.length + unresolved.length) {
    throw new Error(`Output dispositions did not reconcile: ${equation}`);
  }

  const generatedAt = new Date().toISOString();
  const sourceStat = fs.statSync(SOURCE_EXPORT);
  writeJson('run-manifest.json', {
    generated_at: generatedAt,
    read_only: true,
    database_writes: 0,
    watch_records_writes: 0,
    source_export: {
      path: path.resolve(SOURCE_EXPORT),
      bytes: sourceStat.size,
      rows_scanned: sourceScan.rowsScanned,
      sha256: sourceScan.fileSha256,
    },
    selection: 'watch_records.raw_message IS NULL',
    id_selection: EXISTING_IDS_CSV
      ? `Exact ids re-read from ${path.resolve(EXISTING_IDS_CSV)}`
      : 'Indexed UUID and known production-prefix partitions',
    database_snapshot: {
      before_generated_at: beforeCounts.generated_at,
      after_generated_at: afterCounts.generated_at,
      missing_scan_rows: missing.length,
      first_keyset_sha256: firstHash,
      second_keyset_sha256: secondHash,
    },
  });
  writeJson('summary.json', {
    generated_at: generatedAt,
    accepted: true,
    read_only: true,
    database_writes: 0,
    watch_records: total,
    raw_evidence_eligible: eligible,
    missing_raw: missing.length,
    recovered_exact: recovered.length,
    review_candidates: review.length,
    unresolved: unresolved.length,
    equation,
  });
  writeJson('reconciliation.json', {
    accepted: true,
    database: {
      equation: `${total} = ${eligible} + ${missing.length}`,
      watch_records: total,
      raw_evidence_eligible: eligible,
      missing_raw: missing.length,
      first_keyset_sha256: firstHash,
      second_keyset_sha256: secondHash,
    },
    output: {
      equation,
      input: missing.length,
      recovered_exact: recovered.length,
      review_candidates: review.length,
      unresolved: unresolved.length,
    },
  });

  writeCsv('missing-raw-records.private.csv', [
    'id', 'brand', 'reference', 'listing_type', 'source', 'source_type',
    'created_at', 'listing_date', 'thumbnail_url', 'disposition', 'evidence_source',
  ], dispositions.map(({ record, result }) => ({
    ...record,
    flags: undefined,
    disposition: result.disposition,
    evidence_source: result.evidence_source,
  })));
  writeJsonl('recovered-evidence.private.jsonl', recovered.map(({ record, result }) => ({
    record_id: record.id,
    evidence_source: result.evidence_source,
    immutable_raw_message: result.immutable || undefined,
    source_export_match: result.match || undefined,
  })));
  writeJsonl('review-candidates.private.jsonl', review.map(({ record, result }) => ({
    record_id: record.id,
    evidence_source: result.evidence_source,
    matches: result.matches,
  })));
  writeJsonl('unresolved-evidence.private.jsonl', unresolved.map(({ record, result }) => ({
    record,
    reason: result.evidence_source,
  })));
  writeCsv('unresolved.csv', ['record_id', 'brand', 'reference', 'reason'], unresolved.map(({ record, result }) => ({
    record_id: record.id,
    brand: record.brand,
    reference: record.reference,
    reason: result.evidence_source,
  })));

  process.stdout.write(`${JSON.stringify({
    event: 'missing_raw_gap_audit_complete',
    output: OUTPUT_DIR,
    accepted: true,
    missing_raw: missing.length,
    recovered_exact: recovered.length,
    review_candidates: review.length,
    unresolved: unresolved.length,
    equation,
    database_writes: 0,
  })}\n`);
}

module.exports = {
  classifyDisposition,
  imageFilename,
  sourceIdentity,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
