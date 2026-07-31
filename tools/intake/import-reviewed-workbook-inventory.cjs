'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');

const INVENTORY_TABLE = 'reviewed_workbook_inventory';
const CHECKPOINT_TABLE = 'reviewed_workbook_import_checkpoints';
const CONTACT_PUBLICATION_BASIS =
  'OWNER_CONFIRMED_VOLUNTARY_PUBLICATION_2026-07-31';
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

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function positiveNumber(value) {
  const parsed = Number(text(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeConfidence(value) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function canonicalBrand(value) {
  const normalized = text(value).toLowerCase().replace(/[.&]/g, '').replace(/\s+/g, ' ');
  const aliases = {
    pp: 'Patek Philippe',
    patek: 'Patek Philippe',
    'patek philippe': 'Patek Philippe',
    ap: 'Audemars Piguet',
    'audemars piguet': 'Audemars Piguet',
    rolex: 'Rolex',
    'a lange': 'A. Lange & Söhne',
    'a lange sohne': 'A. Lange & Söhne',
    'fp journe': 'F.P. Journe',
    'h moser': 'H. Moser & Cie.',
    'mbf': 'MB&F',
    'jaeger lecoultre': 'Jaeger-LeCoultre',
  };
  return aliases[normalized] || text(value) || null;
}

function brandScope(fileName) {
  const base = fileName.replace(/\.xlsx$/i, '');
  const prefixes = [
    ['Audemars Piguet', 'Audemars Piguet'],
    ['Vacheron Constantin', 'Vacheron Constantin'],
    ['Richard Mille', 'Richard Mille'],
    ['Glashutte Original', 'Glashütte Original'],
    ['Jaeger-LeCoultre', 'Jaeger-LeCoultre'],
    ['Franck Muller', 'Franck Muller'],
    ['Greubel Forsey', 'Greubel Forsey'],
    ['Grand Seiko', 'Grand Seiko'],
    ['Roger Dubuis', 'Roger Dubuis'],
    ['TAG Heuer', 'TAG Heuer'],
    ['FP Journe', 'F.P. Journe'],
    ['A Lange', 'A. Lange & Söhne'],
    ['H Moser', 'H. Moser & Cie.'],
    ['PP ', 'Patek Philippe'],
  ];
  for (const [prefix, brand] of prefixes) {
    if (base.startsWith(prefix)) return brand;
  }
  return canonicalBrand(
    base
      .replace(/_Normalized.*$/i, '')
      .replace(/\s+all\s+.*$/i, '')
      .trim(),
  );
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '') || null;
}

function normalizedRaw(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function listingType(value) {
  const normalized = text(value).toUpperCase();
  if (normalized === 'NTQ') return 'WTB';
  if (normalized === 'WTS' || normalized === 'WTB') return normalized;
  return normalized ? 'OTHER' : null;
}

function isoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function sourcePrice(rawMessage, workbookPrice) {
  const primary = extractPriceObservations(rawMessage, {})
    .find(observation => observation.is_primary) || null;
  if (!primary || primary.currency_evidence !== 'explicit_line_currency') {
    return {
      amount: primary?.amount_original || null,
      rawText: primary?.raw_price_text || null,
      currency: primary?.currency_original || null,
      status: 'CURRENCY_AMBIGUOUS_OR_MISSING',
    };
  }
  if (!['USD', 'USDT'].includes(primary.currency_original)) {
    return {
      amount: primary.amount_original,
      rawText: primary.raw_price_text,
      currency: primary.currency_original,
      status: 'DATED_FX_PROVENANCE_REQUIRED',
    };
  }
  if (workbookPrice === null
    || Math.abs(Number(primary.amount_original) - workbookPrice) > 0.01) {
    return {
      amount: primary.amount_original,
      rawText: primary.raw_price_text,
      currency: primary.currency_original,
      status: 'EXPLICIT_USD_PRICE_CONFLICT',
    };
  }
  return {
    amount: primary.amount_original,
    rawText: primary.raw_price_text,
    currency: primary.currency_original,
    status: 'SOURCE_EXPLICIT_USD_MATCH',
  };
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length !== 1) {
    throw new Error('expected exactly one worksheet');
  }
  const worksheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[worksheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  const headers = Object.keys(rows[0] || {});
  const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`missing headers: ${missing.join(', ')}`);
  return {
    fileSha256: sha256(buffer),
    worksheet,
    rows,
  };
}

function rowForImport({ source, fileName, fileSha256, worksheet, rowNumber, runId }) {
  const scope = brandScope(fileName);
  const suppliedBrand = canonicalBrand(source.Brand);
  const rawMessage = text(source.raw_line) || null;
  const workbookPrice = positiveNumber(source['Price ($ USD)']);
  const price = sourcePrice(rawMessage || '', workbookPrice);
  const normalizedReference = normalizeReference(
    source['Normalized Reference'] || source['Raw Reference'],
  );
  const catalogReference = normalizeReference(source['Catalog Reference']);
  const dialColor = text(source['Dial Color']) || null;
  const catalogDial = text(source['Catalog Dial']) || null;
  const userImage = text(source['User Image URL']) || null;
  const catalogImage = text(source['Catalog Image URL']) || null;
  const finalImage = text(source['Final Image URL']) || null;
  const reasons = ['WORKBOOK_SOURCE_REVIEW'];

  if (!rawMessage) reasons.push('RAW_EVIDENCE_MISSING');
  if (!text(source['Auction ID'])) reasons.push('SOURCE_ID_MISSING');
  if (!isoDate(source['Posting Date'])) reasons.push('POSTING_DATE_INVALID');
  if (!scope || !suppliedBrand || scope !== suppliedBrand) reasons.push('BRAND_SCOPE_CONFLICT');
  if (!text(source.Model)) reasons.push('MODEL_MISSING');
  if (!normalizedReference) reasons.push('REFERENCE_MISSING');
  if (!dialColor) reasons.push('DIAL_MISSING');
  if (catalogReference && normalizedReference && catalogReference !== normalizedReference) {
    reasons.push('REFERENCE_CATALOG_CONFLICT');
  }
  if (catalogDial && dialColor && catalogDial.toLowerCase() !== dialColor.toLowerCase()) {
    reasons.push('DIAL_CATALOG_CONFLICT');
  }
  if (price.status !== 'SOURCE_EXPLICIT_USD_MATCH') reasons.push(price.status);

  const contentSignature = [
    scope || suppliedBrand || '',
    isoDate(source['Posting Date']) || text(source['Posting Date']),
    normalizedRaw(rawMessage),
    normalizedReference || '',
    workbookPrice ?? '',
  ].join('|');
  const contentHash = sha256(contentSignature || `${fileSha256}:${rowNumber}`);
  const sourcePayloadHash = sha256(JSON.stringify(source));

  return {
    id: `workbook_${contentHash}`,
    content_hash: contentHash,
    import_run_id: runId,
    source_file: fileName,
    source_file_sha256: fileSha256,
    source_worksheet: worksheet,
    source_row_number: rowNumber,
    source_record_id: text(source['Auction ID']) || null,
    source_payload_sha256: sourcePayloadHash,
    posting_date: isoDate(source['Posting Date']),
    posted_by: text(source['Posted By']) || null,
    phone_number: text(source['Phone Number']) || null,
    raw_message: rawMessage,
    listing_type: listingType(source['Intent / Type']),
    brand_scope: scope || suppliedBrand || 'Unknown',
    supplied_brand: suppliedBrand,
    canonical_brand: suppliedBrand,
    model: text(source.Model) || null,
    raw_reference: text(source['Raw Reference']) || null,
    normalized_reference: normalizedReference,
    catalog_reference: catalogReference,
    catalog_model: text(source['Catalog Model']) || null,
    dial_color: dialColor,
    catalog_dial: catalogDial,
    condition: text(source.Condition) || null,
    workbook_price_usd: workbookPrice,
    source_price_amount: price.amount,
    source_price_text: price.rawText,
    source_currency: price.currency,
    price_evidence_status: price.status,
    verification_tier: text(source['Verification Tier']) || null,
    confidence: safeConfidence(source['Confidence %']),
    verification_status: text(source['Verification Status']) || null,
    user_image_url: userImage,
    catalog_image_url: catalogImage,
    final_image_url: finalImage,
    display_image_url: userImage,
    image_evidence_type: userImage
      ? 'SELLER_LISTING_IMAGE'
      : (catalogImage || finalImage ? 'REFERENCE_IMAGE' : null),
    review_reasons: [...new Set(reasons)],
    contact_publication_approved: true,
    contact_publication_basis: CONTACT_PUBLICATION_BASIS,
    updated_at: new Date().toISOString(),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  const batchSize = Number.parseInt(values['batch-size'] || '250', 10);
  const workers = Number.parseInt(values.workers || '4', 10);
  const maxRows = Number.parseInt(values['max-rows'] || '0', 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('--batch-size must be 1 through 1000');
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) {
    throw new Error('--workers must be 1 through 4');
  }
  return {
    inputDir: path.resolve(values['input-dir'] || ''),
    outputDir: path.resolve(
      values['output-dir']
        || path.join('audit-output', `reviewed-workbook-live-import-${Date.now()}`),
    ),
    include: text(values.include).toLowerCase(),
    batchSize,
    workers,
    maxRows: Number.isInteger(maxRows) && maxRows > 0 ? maxRows : null,
    apply: process.env.APPLY_REVIEWED_WORKBOOK_IMPORT === 'true',
    runId: values['run-id'] || `reviewed_workbooks_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`,
  };
}

async function upsertCheckpoint(client, payload) {
  const { error } = await client
    .from(CHECKPOINT_TABLE)
    .upsert(payload, { onConflict: 'source_file_sha256' });
  if (error) throw error;
}

async function importBatch(client, rows) {
  const unique = [...new Map(rows.map(row => [row.content_hash, row])).values()];
  const localDuplicates = rows.length - unique.length;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await client
      .from(INVENTORY_TABLE)
      .upsert(unique, { onConflict: 'id', ignoreDuplicates: true })
      .select('id');
    if (!error) {
      const inserted = (data || []).length;
      return {
        input: rows.length,
        inserted,
        duplicates: localDuplicates + unique.length - inserted,
      };
    }
    const retryable = error.code === '40P01'
      || error.code === '55P03'
      || /deadlock|timeout|temporarily unavailable|service unavailable/i.test(error.message);
    if (!retryable || attempt === 5) throw error;
    await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
  }
  throw new Error('unreachable import retry state');
}

async function run() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputDir || !fs.existsSync(options.inputDir)) {
    throw new Error('--input-dir must name the reviewed workbook folder');
  }
  if (options.apply
    && process.env.REVIEWED_WORKBOOK_INVENTORY_TABLE !== INVENTORY_TABLE) {
    throw new Error(`REVIEWED_WORKBOOK_INVENTORY_TABLE must equal ${INVENTORY_TABLE}`);
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const files = fs.readdirSync(options.inputDir)
    .filter(name => name.toLowerCase().endsWith('.xlsx'))
    .filter(name => !options.include || name.toLowerCase().includes(options.include))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (!files.length) throw new Error('No matching .xlsx files found');

  const client = options.apply
    ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false } },
    )
    : null;
  if (options.apply && (!process.env.SUPABASE_URL
    || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY))) {
    throw new Error('Supabase server credentials are required for apply mode');
  }

  const manifest = [];
  const errors = [];
  const totals = {
    files: files.length,
    files_complete: 0,
    rows_scanned: 0,
    rows_inserted: 0,
    rows_duplicate_held: 0,
    rows_errors: 0,
  };
  let remaining = options.maxRows;

  for (const fileName of files) {
    if (remaining !== null && remaining <= 0) break;
    const filePath = path.join(options.inputDir, fileName);
    const workbook = readWorkbook(filePath);
    const expectedRows = workbook.rows.length;
    let resumeAt = 0;
    let inserted = 0;
    let duplicateHeld = 0;
    let rowErrors = 0;

    if (options.apply) {
      const { data: prior, error: checkpointError } = await client
        .from(CHECKPOINT_TABLE)
        .select('rows_scanned,rows_inserted,rows_duplicate_held,rows_errors,status')
        .eq('source_file_sha256', workbook.fileSha256)
        .maybeSingle();
      if (checkpointError) throw checkpointError;
      if (prior) {
        resumeAt = Number(prior.rows_scanned || 0);
        inserted = Number(prior.rows_inserted || 0);
        duplicateHeld = Number(prior.rows_duplicate_held || 0);
        rowErrors = Number(prior.rows_errors || 0);
        if (prior.status === 'COMPLETE' && resumeAt === expectedRows) {
          manifest.push({
            file_name: fileName,
            brand_scope: brandScope(fileName),
            sha256: workbook.fileSha256,
            rows: expectedRows,
            status: 'ALREADY_COMPLETE',
          });
          totals.files_complete += 1;
          totals.rows_scanned += resumeAt;
          totals.rows_inserted += inserted;
          totals.rows_duplicate_held += duplicateHeld;
          totals.rows_errors += rowErrors;
          continue;
        }
      }
      await upsertCheckpoint(client, {
        source_file_sha256: workbook.fileSha256,
        import_run_id: options.runId,
        source_file: fileName,
        brand_scope: brandScope(fileName),
        expected_rows: expectedRows,
        rows_scanned: resumeAt,
        rows_inserted: inserted,
        rows_duplicate_held: duplicateHeld,
        rows_errors: rowErrors,
        status: 'RUNNING',
        started_at: new Date().toISOString(),
        completed_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    }

    const fileLimit = remaining === null
      ? expectedRows
      : Math.min(expectedRows, resumeAt + remaining);
    for (let windowStart = resumeAt;
      windowStart < fileLimit;
      windowStart += options.batchSize * options.workers) {
      const batches = [];
      for (let worker = 0; worker < options.workers; worker += 1) {
        const start = windowStart + worker * options.batchSize;
        const end = Math.min(start + options.batchSize, fileLimit);
        if (start >= end) continue;
        const rows = [];
        for (let index = start; index < end; index += 1) {
          try {
            rows.push(rowForImport({
              source: workbook.rows[index],
              fileName,
              fileSha256: workbook.fileSha256,
              worksheet: workbook.worksheet,
              rowNumber: index + 2,
              runId: options.runId,
            }));
          } catch (error) {
            rowErrors += 1;
            errors.push({
              file_name: fileName,
              worksheet_row: index + 2,
              error: error.message,
            });
          }
        }
        batches.push(options.apply
          ? importBatch(client, rows)
          : Promise.resolve({ input: rows.length, inserted: rows.length, duplicates: 0 }));
      }
      const results = await Promise.all(batches);
      inserted += results.reduce((sum, result) => sum + result.inserted, 0);
      duplicateHeld += results.reduce((sum, result) => sum + result.duplicates, 0);
      const scanned = Math.min(
        windowStart + options.batchSize * options.workers,
        fileLimit,
      );
      if (options.apply) {
        await upsertCheckpoint(client, {
          source_file_sha256: workbook.fileSha256,
          import_run_id: options.runId,
          source_file: fileName,
          brand_scope: brandScope(fileName),
          expected_rows: expectedRows,
          rows_scanned: scanned,
          rows_inserted: inserted,
          rows_duplicate_held: duplicateHeld,
          rows_errors: rowErrors,
          status: scanned === expectedRows ? 'COMPLETE' : 'RUNNING',
          completed_at: scanned === expectedRows ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        });
      }
      process.stdout.write(`${JSON.stringify({
        event: 'workbook_import_progress',
        file: fileName,
        scanned,
        expected_rows: expectedRows,
        inserted,
        duplicate_held: duplicateHeld,
        errors: rowErrors,
        apply: options.apply,
      })}\n`);
    }

    const scanned = fileLimit;
    const fileReconciles = scanned === inserted + duplicateHeld + rowErrors;
    if (!fileReconciles) {
      throw new Error(`${fileName}: checkpoint reconciliation failed`);
    }
    manifest.push({
      file_name: fileName,
      brand_scope: brandScope(fileName),
      sha256: workbook.fileSha256,
      worksheet: workbook.worksheet,
      expected_rows: expectedRows,
      rows_scanned: scanned,
      rows_inserted: inserted,
      rows_duplicate_held: duplicateHeld,
      rows_errors: rowErrors,
      status: scanned === expectedRows ? 'COMPLETE' : 'PARTIAL',
      reconciled: fileReconciles,
    });
    totals.files_complete += Number(scanned === expectedRows);
    totals.rows_scanned += scanned;
    totals.rows_inserted += inserted;
    totals.rows_duplicate_held += duplicateHeld;
    totals.rows_errors += rowErrors;
    if (remaining !== null) remaining -= Math.max(0, scanned - resumeAt);
  }

  const reconciliation = {
    input_rows: totals.rows_scanned,
    inserted_plus_duplicates_plus_errors:
      totals.rows_inserted + totals.rows_duplicate_held + totals.rows_errors,
    exact: totals.rows_scanned
      === totals.rows_inserted + totals.rows_duplicate_held + totals.rows_errors,
  };
  const report = {
    generated_at: new Date().toISOString(),
    mode: options.apply ? 'LIVE_SOURCE_REVIEW_IMPORT' : 'LOCAL_DRY_RUN',
    run_id: options.runId,
    input_dir: options.inputDir,
    target_table: options.apply ? INVENTORY_TABLE : null,
    forbidden_target: 'watch_records',
    worker_count: options.workers,
    batch_size: options.batchSize,
    totals,
    reconciliation,
    runtime_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    source_files: manifest,
  };
  fs.writeFileSync(
    path.join(options.outputDir, 'run-manifest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'reconciliation.json'),
    `${JSON.stringify(reconciliation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'errors.json'),
    `${JSON.stringify(errors, null, 2)}\n`,
  );
  if (!reconciliation.exact) throw new Error('Full import reconciliation failed');
  process.stdout.write(`${JSON.stringify({ status: 'complete', ...report }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  INVENTORY_TABLE,
  brandScope,
  canonicalBrand,
  normalizeReference,
  rowForImport,
  sourcePrice,
};
