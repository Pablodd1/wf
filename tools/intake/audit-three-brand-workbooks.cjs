'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');

const REQUIRED_HEADERS = [
  'Auction ID',
  'Posting Date',
  'Posted By',
  'raw_line',
  'Phone Number',
  'Intent / Type',
  'Brand',
  'Model',
  'Raw Reference',
  'Normalized Reference',
  'Catalog Reference',
  'Catalog Model',
  'Dial Color',
  'Catalog Dial',
  'Condition',
  'Price ($ USD)',
  'Verification Tier',
  'Confidence %',
  'Verification Status',
  'User Image URL',
  'Catalog Image URL',
  'Final Image URL',
];

const EXPECTED_FILES = {
  'Patek Philippe': 138,
  Rolex: 104,
  'Audemars Piguet': 54,
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

function canonicalBrand(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === 'pp' || normalized === 'patek' || normalized === 'patek philippe') {
    return 'Patek Philippe';
  }
  if (normalized === 'rolex') return 'Rolex';
  if (normalized === 'audemars piguet' || normalized === 'ap') return 'Audemars Piguet';
  return text(value) || null;
}

function scopedBrand(fileName) {
  if (/^PP all \d+\.xlsx$/i.test(fileName)) return 'Patek Philippe';
  if (/^Rolex all \d+\.xlsx$/i.test(fileName)) return 'Rolex';
  if (/^Audemars Piguet all \d+\.xlsx$/i.test(fileName)) return 'Audemars Piguet';
  return null;
}

function fileNumber(fileName) {
  return Number(fileName.match(/ all (\d+)\.xlsx$/i)?.[1] || 0);
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '') || null;
}

function normalizeRaw(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function duplicateSignature({ brand, postingDate, rawMessage, reference, price }) {
  return [
    canonicalBrand(brand) || '',
    text(postingDate),
    normalizeRaw(rawMessage),
    normalizeReference(reference) || '',
    price ?? '',
  ].join('|');
}

function priceEvidence(rawMessage, workbookPrice) {
  const primary = extractPriceObservations(rawMessage, {})
    .find(observation => observation.is_primary) || null;
  if (!primary || primary.currency_evidence !== 'explicit_line_currency') {
    return {
      status: 'CURRENCY_AMBIGUOUS_OR_MISSING',
      primary,
      sourceProvenUsd: false,
    };
  }
  if (!['USD', 'USDT'].includes(primary.currency_original)) {
    return {
      status: 'DATED_FX_PROVENANCE_REQUIRED',
      primary,
      sourceProvenUsd: false,
    };
  }
  if (workbookPrice === null
    || Math.abs(Number(primary.amount_original) - workbookPrice) > 0.01) {
    return {
      status: 'EXPLICIT_USD_PRICE_CONFLICT',
      primary,
      sourceProvenUsd: false,
    };
  }
  return {
    status: 'SOURCE_EXPLICIT_USD_MATCH',
    primary,
    sourceProvenUsd: true,
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

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function emptyCoverage() {
  return {
    rows: 0,
    raw_evidence: 0,
    source_id: 0,
    seller_name: 0,
    seller_phone: 0,
    model: 0,
    reference: 0,
    dial: 0,
    workbook_price: 0,
    wts: 0,
    wtb: 0,
    image_url: 0,
    user_image_url: 0,
    catalog_image_url: 0,
    catalog_confirmed: 0,
    complete_identity: 0,
    source_proven_price_research_candidates: 0,
    price_evidence: {},
    blockers: {},
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    values[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return {
    inputDir: path.resolve(values['input-dir'] || ''),
    outputDir: path.resolve(
      values['output-dir']
      || path.join('audit-output', `three-brand-collection-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`),
    ),
    recoveryPath: values['ap17-recovery'] ? path.resolve(values['ap17-recovery']) : null,
    recoverySha256: text(values['ap17-recovery-sha256']).toLowerCase() || null,
    brand: canonicalBrand(values.brand) || null,
  };
}

function discoverFiles(inputDir, selectedBrand = null) {
  const files = fs.readdirSync(inputDir)
    .filter(fileName => scopedBrand(fileName))
    .map(fileName => ({
      fileName,
      requestedPath: path.join(inputDir, fileName),
      brand: scopedBrand(fileName),
      number: fileNumber(fileName),
    }))
    .filter(file => !selectedBrand || file.brand === selectedBrand)
    .sort((left, right) => (
      left.brand.localeCompare(right.brand)
      || left.number - right.number
    ));
  const expectedEntries = Object.entries(EXPECTED_FILES)
    .filter(([brand]) => !selectedBrand || brand === selectedBrand);
  if (selectedBrand && !Object.hasOwn(EXPECTED_FILES, selectedBrand)) {
    throw new Error(`Unsupported --brand ${selectedBrand}`);
  }
  for (const [brand, expected] of expectedEntries) {
    const actual = files.filter(file => file.brand === brand).length;
    if (actual !== expected) {
      throw new Error(`Expected ${expected} ${brand} files, found ${actual}`);
    }
  }
  return files;
}

function readWorkbook(file, recovery) {
  const read = inputPath => {
    const buffer = fs.readFileSync(inputPath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    if (workbook.SheetNames.length !== 1) {
      throw new Error('expected exactly one worksheet');
    }
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const sheetRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const headers = [];
    for (let column = sheetRange.s.c; column <= sheetRange.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: sheetRange.s.r, c: column });
      headers.push(text(sheet[address]?.v));
    }
    const missingHeaders = REQUIRED_HEADERS.filter(header => !headers.includes(header));
    if (missingHeaders.length) {
      throw new Error(`missing headers ${missingHeaders.join(', ')}`);
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
      .filter(row => Object.values(row).some(value => text(value)));
    return {
      selectedPath: inputPath,
      sha256: sha256(buffer),
      sheetName,
      headers,
      rows,
    };
  };

  try {
    return { ...read(file.requestedPath), recovered: false };
  } catch (error) {
    const isRecoverable = file.brand === 'Audemars Piguet'
      && file.number === 17
      && recovery.path;
    if (!isRecoverable) throw new Error(`${file.requestedPath}: ${error.message}`);
    const recovered = read(recovery.path);
    if (!recovery.sha256 || recovered.sha256 !== recovery.sha256) {
      throw new Error('Audemars Piguet shard 17 recovery hash does not match');
    }
    return {
      ...recovered,
      recovered: true,
      recoveryReason: error.message,
    };
  }
}

function bucketFile(root, hash) {
  return path.join(root, `${hash.slice(0, 2)}.tsv`);
}

function appendBucketLines(root, grouped) {
  for (const [prefix, lines] of grouped) {
    fs.appendFileSync(path.join(root, `${prefix}.tsv`), `${lines.join('\n')}\n`);
  }
}

function groupBucketLine(grouped, hash, line) {
  const prefix = hash.slice(0, 2);
  const lines = grouped.get(prefix) || [];
  lines.push(line);
  grouped.set(prefix, lines);
}

function processSourceBuckets(sourceRoot, signatureRoot) {
  const result = {
    nonmissing_rows: 0,
    canonical_source_ids: 0,
    duplicate_groups: 0,
    duplicate_rows: 0,
    duplicate_rows_held: 0,
    conflicting_groups: 0,
    conflicting_rows: 0,
    samples: [],
  };
  const files = fs.readdirSync(sourceRoot).filter(file => file.endsWith('.tsv')).sort();
  for (const fileName of files) {
    const lines = fs.readFileSync(path.join(sourceRoot, fileName), 'utf8')
      .trim().split('\n').filter(Boolean);
    const groups = new Map();
    for (const line of lines) {
      const [sourceHash, signatureHash, rowKey] = line.split('\t');
      const members = groups.get(sourceHash) || [];
      members.push({ sourceHash, signatureHash, rowKey });
      groups.set(sourceHash, members);
    }
    const signatureLines = new Map();
    for (const members of groups.values()) {
      result.nonmissing_rows += members.length;
      result.canonical_source_ids += 1;
      if (members.length > 1) {
        result.duplicate_groups += 1;
        result.duplicate_rows += members.length;
        result.duplicate_rows_held += members.length - 1;
      }
      const signatures = new Set(members.map(member => member.signatureHash));
      if (signatures.size > 1) {
        result.conflicting_groups += 1;
        result.conflicting_rows += members.length;
      }
      if (members.length > 1 && result.samples.length < 100) {
        result.samples.push({
          source_hash: members[0].sourceHash,
          rows: members.length,
          distinct_signatures: signatures.size,
          first_row: members[0].rowKey,
        });
      }
      const canonical = members[0];
      groupBucketLine(
        signatureLines,
        canonical.signatureHash,
        `${canonical.signatureHash}\t${canonical.sourceHash}\t${canonical.rowKey}`,
      );
    }
    appendBucketLines(signatureRoot, signatureLines);
  }
  return result;
}

function processSignatureBuckets(signatureRoot) {
  const result = {
    canonical_rows: 0,
    duplicate_groups: 0,
    duplicate_rows: 0,
    duplicate_rows_held: 0,
    distinct_after_source_and_signature_dedupe: 0,
    samples: [],
  };
  const files = fs.readdirSync(signatureRoot).filter(file => file.endsWith('.tsv')).sort();
  for (const fileName of files) {
    const lines = fs.readFileSync(path.join(signatureRoot, fileName), 'utf8')
      .trim().split('\n').filter(Boolean);
    const groups = new Map();
    for (const line of lines) {
      const [signatureHash, sourceHash, rowKey] = line.split('\t');
      const members = groups.get(signatureHash) || [];
      members.push({ signatureHash, sourceHash, rowKey });
      groups.set(signatureHash, members);
    }
    for (const members of groups.values()) {
      result.canonical_rows += members.length;
      result.distinct_after_source_and_signature_dedupe += 1;
      if (members.length < 2) continue;
      result.duplicate_groups += 1;
      result.duplicate_rows += members.length;
      result.duplicate_rows_held += members.length - 1;
      if (result.samples.length < 100) {
        result.samples.push({
          signature_hash: members[0].signatureHash,
          distinct_source_ids: new Set(members.map(member => member.sourceHash)).size,
          rows: members.length,
          first_row: members[0].rowKey,
        });
      }
    }
  }
  return result;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputDir || !fs.existsSync(options.inputDir)) {
    throw new Error('--input-dir must name the reviewed workbook folder');
  }
  if (options.recoveryPath && !fs.existsSync(options.recoveryPath)) {
    throw new Error('--ap17-recovery does not exist');
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  const bucketRoot = path.join(options.outputDir, '.duplicate-buckets');
  const sourceRoot = path.join(bucketRoot, 'source');
  const signatureRoot = path.join(bucketRoot, 'signature');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(signatureRoot, { recursive: true });

  const files = discoverFiles(options.inputDir, options.brand);
  const activeBrands = Object.keys(EXPECTED_FILES)
    .filter(brand => !options.brand || brand === options.brand);
  const coverage = Object.fromEntries(
    activeBrands.map(brand => [brand, emptyCoverage()]),
  );
  const total = emptyCoverage();
  const manifestFiles = [];
  let missingSourceRows = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const workbook = readWorkbook(file, {
      path: options.recoveryPath,
      sha256: options.recoverySha256,
    });
    const brandCoverage = coverage[file.brand];
    const sourceBucketLines = new Map();
    const missingIdSignatureLines = new Map();

    for (let index = 0; index < workbook.rows.length; index += 1) {
      const source = workbook.rows[index];
      const rowKey = `${file.fileName}:${index + 2}`;
      const sourceId = text(source['Auction ID']);
      const rawMessage = text(source.raw_line);
      const brand = canonicalBrand(source.Brand);
      const model = text(source['Catalog Model'] || source.Model);
      const reference = normalizeReference(
        source['Catalog Reference'] || source['Normalized Reference'],
      );
      const dial = text(source['Catalog Dial'] || source['Dial Color']);
      const price = positiveNumber(source['Price ($ USD)']);
      const intent = text(source['Intent / Type']).toUpperCase() === 'NTQ'
        ? 'WTB'
        : text(source['Intent / Type']).toUpperCase();
      const userImage = text(source['User Image URL']);
      const catalogImage = text(source['Catalog Image URL']);
      const finalImage = text(source['Final Image URL']);
      const evidence = priceEvidence(rawMessage, price);
      const completeIdentity = Boolean(brand === file.brand && model && reference && dial);
      const sourceProvenPrice = intent === 'WTS'
        && price !== null
        && price >= 1000
        && completeIdentity
        && evidence.sourceProvenUsd;

      for (const target of [brandCoverage, total]) {
        target.rows += 1;
        if (rawMessage) target.raw_evidence += 1;
        if (sourceId) target.source_id += 1;
        if (text(source['Posted By'])) target.seller_name += 1;
        if (text(source['Phone Number'])) target.seller_phone += 1;
        if (model) target.model += 1;
        if (reference) target.reference += 1;
        if (dial) target.dial += 1;
        if (price !== null) target.workbook_price += 1;
        if (intent === 'WTS') target.wts += 1;
        if (intent === 'WTB') target.wtb += 1;
        if (finalImage || userImage || catalogImage) target.image_url += 1;
        if (userImage) target.user_image_url += 1;
        if (catalogImage) target.catalog_image_url += 1;
        if (/^Catalog Confirmed$/i.test(text(source['Verification Status']))) {
          target.catalog_confirmed += 1;
        }
        if (completeIdentity) target.complete_identity += 1;
        if (sourceProvenPrice) target.source_proven_price_research_candidates += 1;
        increment(target.price_evidence, evidence.status);
        if (!rawMessage) increment(target.blockers, 'RAW_EVIDENCE_MISSING');
        if (!sourceId) increment(target.blockers, 'SOURCE_ID_MISSING');
        if (brand !== file.brand) increment(target.blockers, 'BRAND_SCOPE_CONFLICT');
        if (!model) increment(target.blockers, 'MODEL_MISSING');
        if (!reference) increment(target.blockers, 'REFERENCE_MISSING');
        if (!dial) increment(target.blockers, 'DIAL_MISSING');
        if (price === null && intent === 'WTS') increment(target.blockers, 'PRICE_MISSING');
        if (intent === 'WTS' && evidence.status !== 'SOURCE_EXPLICIT_USD_MATCH') {
          increment(target.blockers, evidence.status);
        }
        if (!Date.parse(text(source['Posting Date']))) increment(target.blockers, 'POSTING_DATE_INVALID');
      }

      const signatureHash = sha256(duplicateSignature({
        brand,
        postingDate: source['Posting Date'],
        rawMessage,
        reference,
        price,
      }));
      if (sourceId) {
        const sourceHash = sha256(sourceId);
        groupBucketLine(
          sourceBucketLines,
          sourceHash,
          `${sourceHash}\t${signatureHash}\t${rowKey}`,
        );
      } else {
        missingSourceRows += 1;
        const pseudoSourceHash = sha256(`missing:${rowKey}`);
        groupBucketLine(
          missingIdSignatureLines,
          signatureHash,
          `${signatureHash}\t${pseudoSourceHash}\t${rowKey}`,
        );
      }
    }

    appendBucketLines(sourceRoot, sourceBucketLines);
    appendBucketLines(signatureRoot, missingIdSignatureLines);
    manifestFiles.push({
      file_name: file.fileName,
      brand: file.brand,
      file_number: file.number,
      requested_path: file.requestedPath,
      selected_path: workbook.selectedPath,
      sha256: workbook.sha256,
      worksheet: workbook.sheetName,
      rows: workbook.rows.length,
      headers: workbook.headers,
      recovered: workbook.recovered,
      recovery_reason: workbook.recoveryReason || null,
    });
    process.stdout.write(JSON.stringify({
      event: 'workbook_scanned',
      current: fileIndex + 1,
      total: files.length,
      file: file.fileName,
      rows: workbook.rows.length,
      recovered: workbook.recovered,
    }) + '\n');
  }

  const sourceDuplicates = processSourceBuckets(sourceRoot, signatureRoot);
  const signatureDuplicates = processSignatureBuckets(signatureRoot);
  const duplicateSummary = {
    missing_source_id_rows: missingSourceRows,
    source_id: sourceDuplicates,
    exact_content_after_source_id_dedupe: signatureDuplicates,
  };
  const reconciliation = {
    input_rows: total.rows,
    source_id_rows_plus_missing: sourceDuplicates.nonmissing_rows + missingSourceRows,
    source_id_reconciled: total.rows === sourceDuplicates.nonmissing_rows + missingSourceRows,
    source_canonical_plus_source_duplicate_held_plus_missing: (
      sourceDuplicates.canonical_source_ids
      + sourceDuplicates.duplicate_rows_held
      + missingSourceRows
    ),
    signature_canonical_input: signatureDuplicates.canonical_rows,
    signature_distinct_plus_held: (
      signatureDuplicates.distinct_after_source_and_signature_dedupe
      + signatureDuplicates.duplicate_rows_held
    ),
    exact: total.rows === sourceDuplicates.nonmissing_rows + missingSourceRows
      && signatureDuplicates.canonical_rows
        === signatureDuplicates.distinct_after_source_and_signature_dedupe
          + signatureDuplicates.duplicate_rows_held,
  };
  const report = {
    generated_at: new Date().toISOString(),
    mode: 'local_read_only_three_brand_collection_audit',
    database_writes: 0,
    source_folder: options.inputDir,
    file_counts: Object.fromEntries(
      activeBrands.map(brand => [brand, EXPECTED_FILES[brand]]),
    ),
    coverage,
    total,
    duplicates: duplicateSummary,
    reconciliation,
    release_decision: 'SHADOW_CANARY_REQUIRED_BEFORE_PRODUCTION_PUBLICATION',
    notes: [
      'Patek source value PP is canonicalized to Patek Philippe without changing raw evidence.',
      'Exact-content duplicate signatures include canonical brand, posting date, normalized raw message, reference, and workbook price.',
      'Missing or unreachable images are text-only and do not block an otherwise eligible Trading Floor row.',
      'Catalog/reference images are not seller listing photos and require customer-facing provenance disclosure.',
      'Non-USD source prices require dated FX rate, source, and date before Price Research publication.',
      'Bundle/multi-listing disposition and production collision checks remain separate release gates.',
    ],
  };

  fs.writeFileSync(
    path.join(options.outputDir, 'run-manifest.json'),
    `${JSON.stringify({
      generated_at: report.generated_at,
      mode: report.mode,
      database_writes: 0,
      source_files: manifestFiles,
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'coverage-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'duplicates.json'),
    `${JSON.stringify(duplicateSummary, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'reconciliation.json'),
    `${JSON.stringify(reconciliation, null, 2)}\n`,
  );
  writeCsv(
    path.join(options.outputDir, 'coverage-report.csv'),
    [
      'brand',
      'rows',
      'raw_evidence',
      'source_id',
      'complete_identity',
      'wts',
      'wtb',
      'workbook_price',
      'source_proven_price_research_candidates',
      'seller_name',
      'seller_phone',
      'image_url',
      'user_image_url',
      'catalog_image_url',
      'catalog_confirmed',
    ],
    [
      ...Object.entries(coverage).map(([brand, values]) => ({ brand, ...values })),
      { brand: 'TOTAL', ...total },
    ],
  );
  writeCsv(
    path.join(options.outputDir, 'blockers-by-reason.csv'),
    ['reason', 'row_count'],
    Object.entries(total.blockers)
      .map(([reason, row_count]) => ({ reason, row_count }))
      .sort((left, right) => right.row_count - left.row_count),
  );
  writeCsv(
    path.join(options.outputDir, 'duplicate-summary.csv'),
    ['gate', 'groups', 'rows', 'held', 'conflicting_groups', 'conflicting_rows'],
    [
      {
        gate: 'SOURCE_ID',
        groups: sourceDuplicates.duplicate_groups,
        rows: sourceDuplicates.duplicate_rows,
        held: sourceDuplicates.duplicate_rows_held,
        conflicting_groups: sourceDuplicates.conflicting_groups,
        conflicting_rows: sourceDuplicates.conflicting_rows,
      },
      {
        gate: 'EXACT_CONTENT_AFTER_SOURCE_ID',
        groups: signatureDuplicates.duplicate_groups,
        rows: signatureDuplicates.duplicate_rows,
        held: signatureDuplicates.duplicate_rows_held,
        conflicting_groups: 0,
        conflicting_rows: 0,
      },
    ],
  );

  fs.rmSync(bucketRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    status: 'complete',
    output_dir: options.outputDir,
    rows: total.rows,
    distinct_after_exact_dedupe: signatureDuplicates.distinct_after_source_and_signature_dedupe,
    source_proven_price_research_candidates: total.source_proven_price_research_candidates,
    reconciliation,
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
  canonicalBrand,
  duplicateSignature,
  normalizeReference,
  priceEvidence,
  scopedBrand,
};
