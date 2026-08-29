'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const {
  canonicalBrand,
  duplicateSignature,
  normalizeReference,
  priceEvidence,
} = require('./audit-three-brand-workbooks.cjs');

const VERSION = 'reviewed-three-brand-canary-v1';
const NORMALIZATION_VERSION = 'v4.3-mint-condition';
const SAMPLE_PLAN = {
  'Patek Philippe': { quota: 33334, files: [1, 105, 138] },
  Rolex: { quota: 33333, files: [1, 100, 104] },
  'Audemars Piguet': { quota: 33333, files: [1, 27, 54] },
};
function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positiveNumber(value) {
  const parsed = Number(text(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeIntent(value) {
  const intent = text(value).toUpperCase();
  if (intent === 'NTQ') return 'WTB';
  return ['WTS', 'WTB'].includes(intent) ? intent : null;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return {
    manifests: text(values.manifests).split('|').filter(Boolean).map(file => path.resolve(file)),
    outputDir: path.resolve(
      values['output-dir']
      || path.join('audit-output', `three-brand-shadow-canary-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`),
    ),
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const string = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function writeCsv(filePath, columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => csvCell(row[column])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function loadLockedFiles(manifestPaths) {
  if (manifestPaths.length !== 3) {
    throw new Error('--manifests must contain the three pipe-separated brand run manifests');
  }
  const files = [];
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.database_writes !== 0 || !Array.isArray(manifest.source_files)) {
      throw new Error(`${manifestPath}: invalid read-only source manifest`);
    }
    files.push(...manifest.source_files);
  }
  return files;
}

function sampleFileRows(locked, take) {
  const buffer = fs.readFileSync(locked.selected_path);
  const actualHash = sha256(buffer);
  if (actualHash !== locked.sha256) {
    throw new Error(`${locked.file_name}: workbook hash changed`);
  }
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== locked.worksheet) {
    throw new Error(`${locked.file_name}: worksheet changed`);
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[locked.worksheet], {
    defval: null,
    raw: true,
  }).filter(row => Object.values(row).some(value => text(value)));
  if (rows.length !== locked.rows) {
    throw new Error(`${locked.file_name}: row count changed`);
  }
  if (rows.length < take) {
    throw new Error(`${locked.file_name}: cannot supply the planned ${take} rows`);
  }
  if (take === rows.length) {
    return rows.map((row, index) => ({ row, worksheetRow: index + 2 }));
  }
  const sampled = [];
  for (let index = 0; index < take; index += 1) {
    const sourceIndex = Math.floor(((index + 0.5) * rows.length) / take);
    sampled.push({ row: rows[sourceIndex], worksheetRow: sourceIndex + 2 });
  }
  return sampled;
}

function selectedFiles(lockedFiles) {
  const selected = [];
  for (const [brand, plan] of Object.entries(SAMPLE_PLAN)) {
    const perFile = Math.floor(plan.quota / plan.files.length);
    let remainder = plan.quota % plan.files.length;
    for (const number of plan.files) {
      const locked = lockedFiles.find(file => (
        file.brand === brand && Number(file.file_number) === number
      ));
      if (!locked) throw new Error(`Missing locked ${brand} file ${number}`);
      const take = perFile + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      selected.push({ brand, take, locked });
    }
  }
  return selected;
}

function imageEvidence(source) {
  const user = text(source['User Image URL']);
  const catalog = text(source['Catalog Image URL']);
  const final = text(source['Final Image URL']);
  if (user) {
    return {
      status: 'USER_IMAGE_CANDIDATE',
      url: final || user,
      source_url: user,
      evidence_type: 'SELLER_LISTING_IMAGE',
    };
  }
  if (catalog || final) {
    return {
      status: 'REFERENCE_IMAGE_CANDIDATE',
      url: final || catalog,
      source_url: catalog || final,
      evidence_type: 'REFERENCE_IMAGE',
    };
  }
  return {
    status: 'TEXT_ONLY',
    url: null,
    source_url: null,
    evidence_type: null,
  };
}

function baseDisposition(row) {
  if (row.technical_errors.length) return 'TECHNICAL_ERROR';
  if (row.duplicate_copy) return 'DUPLICATE_COPY_HELD';
  if (row.review_reasons.length) return 'HUMAN_REVIEW_REQUIRED';
  if (row.listing_type === 'WTB') return 'TRADING_FLOOR_READY_WTB';
  if (row.price_research_eligible) {
    return 'TRADING_FLOOR_AND_PRICE_RESEARCH_READY';
  }
  return 'TRADING_FLOOR_READY_PRICE_RESEARCH_HELD';
}

function canonicalRow({ source, worksheetRow, locked, brand }) {
  const sourceId = text(source['Auction ID']);
  const rawMessage = text(source.raw_line);
  const workbookPrice = positiveNumber(source['Price ($ USD)']);
  const listingType = normalizeIntent(source['Intent / Type']);
  const normalizedBrand = canonicalBrand(source.Brand);
  const model = text(source['Catalog Model'] || source.Model) || null;
  const reference = normalizeReference(
    source['Catalog Reference'] || source['Normalized Reference'],
  );
  const dialColor = text(source['Catalog Dial'] || source['Dial Color']) || null;
  const evidence = priceEvidence(rawMessage, workbookPrice);
  const analyzerInput = {
    id: sourceId || `missing:${locked.sha256}:${worksheetRow}`,
    raw_message: rawMessage,
    brand: normalizedBrand,
    reference,
    dial_color: dialColor,
    listing_type: listingType,
    price_raw: evidence.primary?.amount_original || null,
    price_usd: evidence.sourceProvenUsd ? workbookPrice : null,
    currency: evidence.primary?.currency_original || null,
    parser_version: text(source['Verification Status']) || null,
  };
  const analysis = analyzeRecord(analyzerInput);
  const changeFlags = analysis.change_flags || [];
  const technicalErrors = [];
  const reviewReasons = [];
  const qualityFlags = [...changeFlags];
  if (!sourceId) technicalErrors.push('SOURCE_ID_MISSING');
  if (!rawMessage) technicalErrors.push('RAW_EVIDENCE_MISSING');
  if (!Date.parse(text(source['Posting Date']))) qualityFlags.push('POSTING_DATE_INVALID');
  if (!listingType) technicalErrors.push('INTENT_INVALID');
  if (normalizedBrand !== brand) reviewReasons.push('BRAND_SCOPE_CONFLICT');
  if (!model) reviewReasons.push('MODEL_MISSING');
  if (!reference) reviewReasons.push('REFERENCE_MISSING');
  if (!dialColor) reviewReasons.push('DIAL_MISSING');
  if (analysis.candidate_count > 1) reviewReasons.push('BUNDLE_SPLIT_REQUIRED');
  const image = imageEvidence(source);
  return {
    record_id: `reviewed_canary_${sha256(`${locked.sha256}:${worksheetRow}:${sourceId}`).slice(0, 32)}`,
    source_id: sourceId || null,
    source_file: locked.file_name,
    source_workbook_sha256: locked.sha256,
    worksheet: locked.worksheet,
    worksheet_row: worksheetRow,
    source_row_sha256: sha256(JSON.stringify(source)),
    raw_message: rawMessage,
    posting_date: text(source['Posting Date']) || null,
    seller_name: text(source['Posted By']) || null,
    seller_phone: text(source['Phone Number']) || null,
    listing_type: listingType,
    brand: normalizedBrand,
    model,
    reference,
    dial_color: dialColor,
    condition: text(source.Condition) || null,
    workbook_price_usd: workbookPrice,
    source_price_raw: evidence.primary?.amount_original || null,
    source_currency: evidence.primary?.currency_original || null,
    price_evidence_status: evidence.status,
    image,
    catalog_status: /^Catalog Confirmed$/i.test(text(source['Verification Status']))
      ? 'CATALOG_CONFIRMED'
      : 'CATALOG_NOT_AVAILABLE',
    normalization_version: analysis.normalization_version,
    candidate_count: analysis.candidate_count,
    deterministic_change_flags: changeFlags,
    quality_flags: [...new Set(qualityFlags)],
    review_reasons: [...new Set(reviewReasons)],
    technical_errors: [...new Set(technicalErrors)],
    duplicate_signature: duplicateSignature({
      brand: normalizedBrand,
      postingDate: source['Posting Date'],
      rawMessage,
      reference,
      price: workbookPrice,
    }),
    duplicate_copy: false,
    price_research_eligible: false,
    disposition: null,
  };
}

async function run() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const lockedFiles = loadLockedFiles(options.manifests);
  const selected = selectedFiles(lockedFiles);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const rows = [];
  const errors = [];
  const sourceFiles = [];
  let peakRss = process.memoryUsage().rss;

  for (const item of selected) {
    const samples = sampleFileRows(item.locked, item.take);
    for (const sample of samples) {
      try {
        rows.push(canonicalRow({
          source: sample.row,
          worksheetRow: sample.worksheetRow,
          locked: item.locked,
          brand: item.brand,
        }));
      } catch (error) {
        errors.push({
          file_name: item.locked.file_name,
          worksheet_row: sample.worksheetRow,
          error: error.message,
        });
      }
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    sourceFiles.push({
      brand: item.brand,
      file_name: item.locked.file_name,
      sha256: item.locked.sha256,
      worksheet: item.locked.worksheet,
      source_rows: item.locked.rows,
      sampled_rows: item.take,
    });
  }

  const signatureGroups = new Map();
  for (const row of rows) {
    const members = signatureGroups.get(row.duplicate_signature) || [];
    members.push(row);
    signatureGroups.set(row.duplicate_signature, members);
  }
  const duplicateGroups = [];
  for (const members of signatureGroups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((left, right) => (
      Number(Boolean(right.image.url)) - Number(Boolean(left.image.url))
      || Number(Boolean(right.seller_phone)) - Number(Boolean(left.seller_phone))
      || Date.parse(right.posting_date || 0) - Date.parse(left.posting_date || 0)
      || left.record_id.localeCompare(right.record_id)
    ));
    for (const duplicate of ordered.slice(1)) duplicate.duplicate_copy = true;
    duplicateGroups.push({
      group_id: sha256(members[0].duplicate_signature).slice(0, 16),
      rows: members.length,
      primary_record_id: ordered[0].record_id,
      held_record_ids: ordered.slice(1).map(row => row.record_id),
    });
  }

  for (const row of rows) {
    row.price_research_eligible = !row.duplicate_copy
      && row.technical_errors.length === 0
      && row.review_reasons.length === 0
      && row.listing_type === 'WTS'
      && row.workbook_price_usd >= 1000
      && row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH';
    row.disposition = baseDisposition(row);
  }

  const dispositions = {};
  const blockers = {};
  const brands = {};
  const images = {};
  for (const row of rows) {
    increment(dispositions, row.disposition);
    increment(brands, row.brand || 'MISSING');
    increment(images, row.image.status);
    for (const blocker of [
      ...row.technical_errors,
      ...row.review_reasons,
      ...(row.duplicate_copy ? ['DUPLICATE_COPY_HELD'] : []),
      ...(row.listing_type === 'WTS'
        && !row.price_research_eligible
        && row.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'
        ? [row.price_evidence_status]
        : []),
    ]) increment(blockers, blocker);
  }
  const durationSeconds = (Date.now() - startedAt) / 1000;
  const dispositionRows = Object.values(dispositions).reduce((sum, value) => sum + value, 0);
  const reconciliation = {
    planned_input_rows: 100000,
    normalized_rows: rows.length,
    extraction_errors: errors.length,
    disposition_rows: dispositionRows,
    input_equals_rows_plus_errors: 100000 === rows.length + errors.length,
    rows_equal_dispositions: rows.length === dispositionRows,
    exact: 100000 === rows.length + errors.length && rows.length === dispositionRows,
  };
  const counts = {
    input_rows: 100000,
    rows: rows.length,
    errors: errors.length,
    dispositions,
    brands,
    images,
    duplicate_groups: duplicateGroups.length,
    duplicate_copies_held: rows.filter(row => row.duplicate_copy).length,
    trading_floor_ready: rows.filter(row => row.disposition.startsWith('TRADING_FLOOR')).length,
    price_research_ready: rows.filter(row => row.price_research_eligible).length,
    seller_name: rows.filter(row => row.seller_name).length,
    seller_phone: rows.filter(row => row.seller_phone).length,
    catalog_confirmed: rows.filter(row => row.catalog_status === 'CATALOG_CONFIRMED').length,
  };
  const benchmark = {
    runtime_seconds: Number(durationSeconds.toFixed(3)),
    rows_per_second: Number((100000 / durationSeconds).toFixed(2)),
    peak_rss_bytes: peakRss,
    peak_rss_mb: Number((peakRss / 1024 / 1024).toFixed(1)),
    worker_count: 1,
    workbook_files_loaded: selected.length,
    recommended_database_workers_after_shadow_acceptance: 4,
    recommended_database_batch_size: 250,
  };
  const manifest = {
    generated_at: new Date().toISOString(),
    mode: 'local_only_mixed_three_brand_shadow_canary',
    version: VERSION,
    normalization_version: NORMALIZATION_VERSION,
    source_files: sourceFiles,
    counts,
    reconciliation,
    benchmark,
    database_writes: 0,
    forbidden_target: 'watch_records',
  };

  fs.writeFileSync(
    path.join(options.outputDir, 'run-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'coverage-report.json'),
    `${JSON.stringify({ counts, blockers }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'reconciliation.json'),
    `${JSON.stringify(reconciliation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'benchmark.json'),
    `${JSON.stringify(benchmark, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'duplicate-groups.json'),
    `${JSON.stringify(duplicateGroups, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'canonical-rows.private.jsonl'),
    `${rows.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  writeCsv(
    path.join(options.outputDir, 'coverage-report.csv'),
    ['metric', 'value'],
    Object.entries({
      ...counts,
      dispositions: JSON.stringify(dispositions),
      brands: JSON.stringify(brands),
      images: JSON.stringify(images),
    }).map(([metric, value]) => ({ metric, value })),
  );
  writeCsv(
    path.join(options.outputDir, 'blockers-by-reason.csv'),
    ['reason', 'row_count'],
    Object.entries(blockers)
      .map(([reason, row_count]) => ({ reason, row_count }))
      .sort((left, right) => right.row_count - left.row_count),
  );
  writeCsv(
    path.join(options.outputDir, 'changed-records.csv'),
    ['record_id', 'brand', 'reference', 'source_file', 'worksheet_row', 'change_flags'],
    rows
      .filter(row => row.deterministic_change_flags.length)
      .map(row => ({ ...row, change_flags: row.deterministic_change_flags })),
  );
  writeCsv(
    path.join(options.outputDir, 'errors.csv'),
    ['file_name', 'worksheet_row', 'error'],
    errors,
  );

  if (!reconciliation.exact) {
    throw new Error('Canary reconciliation failed');
  }
  process.stdout.write(`${JSON.stringify({
    status: 'complete',
    output_dir: options.outputDir,
    counts,
    reconciliation,
    benchmark,
    database_writes: 0,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  baseDisposition,
  imageEvidence,
  normalizeIntent,
};
