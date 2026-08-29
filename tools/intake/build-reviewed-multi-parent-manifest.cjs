'use strict';

// Global, read-only multi-parent census. It combines every supplied workbook
// before assigning a routing brand, so cross-workbook messages never depend on
// import order. Output rows match reviewed_workbook_inventory but this tool has
// no database client and cannot apply them.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  buildMultiParentRows,
  readAdmissionWorkbook,
} = require('./import-approved-admission-workbook.cjs');

const INVENTORY_TABLE = 'reviewed_workbook_inventory';
const MULTI_STATUS = 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY';
const MULTI_TIER = 'OWNER_MULTI_PARENT_SOURCE_LINEAGE_V1';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseInputSpec(value) {
  const separator = String(value || '').indexOf('=');
  if (separator < 1) throw new Error(`invalid --input spec ${value}; expected Brand=absolute-path.xlsx`);
  const brand = text(value.slice(0, separator));
  const input = path.resolve(text(value.slice(separator + 1)));
  if (!brand || !input) throw new Error(`invalid --input spec ${value}`);
  return { brand, input };
}

function parseArgs(argv) {
  const inputs = [];
  let outputDir = null;
  let runId = null;
  let batchSize = 100;
  let maxRows = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--input') inputs.push(parseInputSpec(argv[++index]));
    else if (flag === '--output-dir') outputDir = path.resolve(argv[++index]);
    else if (flag === '--run-id') runId = text(argv[++index]);
    else if (flag === '--batch-size') batchSize = Number.parseInt(argv[++index], 10);
    else if (flag === '--max-rows') maxRows = Number.parseInt(argv[++index], 10);
    else throw new Error(`unsupported argument ${flag}`);
  }
  if (!inputs.length) throw new Error('at least one --input Brand=path is required');
  if (!outputDir) throw new Error('--output-dir is required');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('--batch-size must be 1 through 100');
  }
  if (maxRows !== null && (!Number.isInteger(maxRows) || maxRows < 1)) {
    throw new Error('--max-rows must be a positive integer');
  }
  return {
    inputs, outputDir, batchSize, maxRows,
    runId: runId || `multi_parent_census_${Date.now()}`,
    apply: process.env.APPLY_REVIEWED_MULTI_PARENT_IMPORT === 'true',
  };
}

function itemSequence(source, fallback) {
  const match = text(source?.listing_id).match(/_item_(\d+)$/i);
  return match ? Number(match[1]) : fallback;
}

function loadWorkbookEntries(spec) {
  const workbook = readAdmissionWorkbook(spec.input);
  const fileName = path.basename(spec.input);
  const entries = [];
  let missingDecisions = 0;
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) {
      missingDecisions += 1;
      return;
    }
    entries.push({
      source,
      decision,
      rowNumber: index + 2,
      itemSequence: itemSequence(source, index + 2),
      expectedBrand: spec.brand,
      fileName,
      fileSha256: workbook.fileSha256,
    });
  });
  return {
    brand: spec.brand,
    input: spec.input,
    fileName,
    fileSha256: workbook.fileSha256,
    sourceRows: workbook.sourceRows.length,
    missingDecisions,
    entries,
  };
}

function parentSourceIdsForEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const id = text(entry.source?.source_message_id);
    if (!id) continue;
    const group = grouped.get(id) || [];
    group.push(entry);
    grouped.set(id, group);
  }
  const result = new Set();
  for (const [id, group] of grouped) {
    const childIds = new Set(group.map(entry => text(entry.source?.listing_id)).filter(Boolean));
    const explicit = group.some(entry => [
      'BUNDLE_PARENT', 'BUNDLE_PENDING', 'MULTI', 'MULTI_LISTING', 'MULTI_PENDING',
    ].includes(text(entry.decision?.bundle_status).toUpperCase()));
    if (childIds.size > 1 || explicit) result.add(id);
  }
  return result;
}

function buildGlobalManifest(loaded, runId) {
  const stableLoaded = [...loaded].sort((left, right) => (
    left.brand.localeCompare(right.brand)
    || left.fileSha256.localeCompare(right.fileSha256)
    || left.fileName.localeCompare(right.fileName)
  ));
  const entries = stableLoaded.flatMap(file => file.entries);
  const resolution = buildMultiParentRows({ entries, runId });
  const parentIdsByBrand = new Map();
  for (const file of stableLoaded) parentIdsByBrand.set(file.brand, parentSourceIdsForEntries(file.entries));
  const participatingBrandsBySource = new Map();
  for (const entry of entries) {
    const id = text(entry.source?.source_message_id);
    if (!id) continue;
    const brands = participatingBrandsBySource.get(id) || new Set();
    brands.add(entry.expectedBrand);
    participatingBrandsBySource.set(id, brands);
  }
  const admittedSourceIds = new Set(resolution.parents.map(row => row.source_record_id));
  const perBrand = stableLoaded.map(file => ({
    brand: file.brand,
    source_rows: file.sourceRows,
    missing_decisions: file.missingDecisions,
    parent_candidates_in_file: parentIdsByBrand.get(file.brand).size,
    globally_admitted_parent_copies_in_file: [...parentIdsByBrand.get(file.brand)]
      .filter(id => admittedSourceIds.has(id)).length,
    globally_admitted_parents_with_brand: [...admittedSourceIds].filter(
      id => participatingBrandsBySource.get(id)?.has(file.brand),
    ).length,
    globally_routed_parents: resolution.parents.filter(row => row.brand_scope === file.brand).length,
  }));
  const heldReasons = {};
  for (const held of resolution.held) {
    for (const reason of held.reasons) heldReasons[reason] = (heldReasons[reason] || 0) + 1;
  }
  return {
    rows: resolution.parents,
    report: {
      mode: 'LOCAL_GLOBAL_READ_ONLY',
      target_schema: 'public.reviewed_workbook_inventory',
      database_writes: 0,
      files: stableLoaded.length,
      source_rows: stableLoaded.reduce((sum, file) => sum + file.sourceRows, 0),
      missing_decisions: stableLoaded.reduce((sum, file) => sum + file.missingDecisions, 0),
      per_file_parent_candidates: perBrand.reduce((sum, item) => sum + item.parent_candidates_in_file, 0),
      global_unique_multi_parents: resolution.parents.length,
      duplicate_parent_copies_eliminated: perBrand.reduce(
        (sum, item) => sum + item.globally_admitted_parent_copies_in_file, 0,
      ) - resolution.parents.length,
      cross_brand_parents: resolution.parents.filter(row => row.supplied_brand === 'Multiple brands').length,
      held_parent_groups: resolution.held.length,
      held_reasons: heldReasons,
      per_brand: perBrand,
      invariants: {
        deterministic_id: 'admission_multi_sha256(source_message_id)',
        price: null,
        media: null,
        contact: null,
        price_research: 'excluded',
      },
    },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function validateMultiParentRow(row) {
  const errors = [];
  if (row.id !== `admission_multi_${sha256(row.source_record_id)}`) errors.push('ID_LINEAGE_MISMATCH');
  if (!/^[0-9a-f]{64}$/i.test(text(row.content_hash))) errors.push('CONTENT_HASH_INVALID');
  if (!/^[0-9a-f]{64}$/i.test(text(row.source_payload_sha256))) errors.push('SOURCE_PAYLOAD_HASH_INVALID');
  if (!text(row.source_record_id) || !text(row.raw_message)) errors.push('RAW_LINEAGE_MISSING');
  if (row.listing_type !== 'MULTI') errors.push('LISTING_TYPE_NOT_MULTI');
  if (row.verification_status !== MULTI_STATUS) errors.push('VERIFICATION_STATUS_INVALID');
  if (row.verification_tier !== MULTI_TIER) errors.push('VERIFICATION_TIER_INVALID');
  if (row.price_evidence_status !== 'MULTI_PARENT_PRICE_WITHHELD') errors.push('PRICE_STATUS_INVALID');
  for (const field of [
    'workbook_price_usd', 'source_price_amount', 'source_price_text', 'source_currency',
    'user_image_url', 'catalog_image_url', 'final_image_url', 'display_image_url', 'image_evidence_type',
    'phone_number', 'contact_publication_basis', 'raw_reference', 'normalized_reference',
    'catalog_reference', 'dial_color', 'catalog_dial', 'condition',
  ]) {
    if (row[field] !== null) errors.push(`${field.toUpperCase()}_MUST_BE_NULL`);
  }
  if (row.contact_publication_approved !== false) errors.push('CONTACT_MUST_BE_WITHHELD');
  if (!text(row.brand_scope) || !text(row.posted_by) || !row.posting_date) errors.push('DISPLAY_LINEAGE_INCOMPLETE');
  return errors;
}

async function publishRows(client, rows, batchSize) {
  for (const row of rows) {
    const errors = validateMultiParentRow(row);
    if (errors.length) throw new Error(`unsafe multi-parent row ${row.id}: ${errors.join(',')}`);
  }
  let inserted = 0;
  let reconciled = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { data: written, error: writeError } = await client
      .from(INVENTORY_TABLE)
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: true })
      .select('id');
    if (writeError) throw writeError;
    inserted += (written || []).length;
    const ids = batch.map(row => row.id);
    const { data: confirmed, error: reconcileError } = await client
      .from(INVENTORY_TABLE)
      .select('id')
      .in('id', ids);
    if (reconcileError) throw reconcileError;
    const confirmedIds = new Set((confirmed || []).map(row => row.id));
    const missing = ids.filter(id => !confirmedIds.has(id));
    if (missing.length) throw new Error(`multi-parent bounded reconciliation missing ${missing.length} ids`);
    reconciled += confirmedIds.size;
  }
  return { inserted, reconciled };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const loaded = options.inputs.map(loadWorkbookEntries);
  const manifest = buildGlobalManifest(loaded, options.runId);
  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(options.outputDir, 'multi-parent-rows.jsonl'),
    `${manifest.rows.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  if (options.apply) {
    if (process.env.REVIEWED_WORKBOOK_INVENTORY_TABLE !== INVENTORY_TABLE) {
      throw new Error(`REVIEWED_WORKBOOK_INVENTORY_TABLE must equal ${INVENTORY_TABLE}`);
    }
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!process.env.SUPABASE_URL || !secret) throw new Error('Supabase server credentials are required');
    const client = createClient(process.env.SUPABASE_URL, secret, { auth: { persistSession: false } });
    const rowsForApply = options.maxRows === null
      ? manifest.rows
      : manifest.rows.slice(0, options.maxRows);
    const result = await publishRows(client, rowsForApply, options.batchSize);
    manifest.report.mode = 'SERVICE_ONLY_GLOBAL_APPLY';
    manifest.report.database_writes = result.inserted;
    manifest.report.reconciled_exact_ids = result.reconciled;
    manifest.report.apply_rows_selected = rowsForApply.length;
    manifest.report.apply_rows_available = manifest.rows.length;
    manifest.report.apply_scope = options.maxRows === null ? 'FULL' : 'BOUNDED_CANARY';
  }
  fs.writeFileSync(
    path.join(options.outputDir, 'multi-parent-census.json'),
    `${JSON.stringify(manifest.report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest.report, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildGlobalManifest,
  loadWorkbookEntries,
  parseArgs,
  parseInputSpec,
  publishRows,
  run,
  validateMultiParentRow,
};
