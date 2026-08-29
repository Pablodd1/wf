'use strict';

// Read-only admission bundle audit. This intentionally does not split raw text:
// a child may be published only when a human-reviewed child ledger identifies
// its own immutable segment, price evidence, and exact image association.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SOURCE_SHEET = 'Trading Floor & Price Research';
const CHILD_HEADERS = [
  'parent_listing_id',
  'child_listing_id',
  'child_index',
  'child_raw_message',
  'final_brand',
  'final_model',
  'final_reference',
  'dial_normalized',
  'listing_type',
  'source_price_text',
  'source_price_amount',
  'source_currency',
  'child_image_url',
  'image_association_status',
  'review_status',
  'reviewed_by',
  'reviewed_at',
];

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const decisionSheetName = workbook.SheetNames.find(
    name => name !== SOURCE_SHEET && /admission/i.test(name),
  );
  if (!workbook.Sheets[SOURCE_SHEET] || !decisionSheetName) {
    throw new Error(`admission worksheets missing from ${path.basename(filePath)}`);
  }
  const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[SOURCE_SHEET], {
    defval: null,
    raw: true,
  });
  const decisionRows = XLSX.utils.sheet_to_json(workbook.Sheets[decisionSheetName], {
    defval: null,
    raw: true,
  });
  return {
    buffer,
    sourceRows,
    decisionRows,
    decisionSheetName,
  };
}

function readChildLedger(filePath) {
  if (!filePath) return { rows: [], missingHeaders: CHILD_HEADERS };
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames.find(name => /child/i.test(name));
  if (!sheetName) throw new Error('child ledger workbook must contain a sheet with "child" in its name');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true });
  const headers = Object.keys(rows[0] || {});
  return {
    rows,
    missingHeaders: CHILD_HEADERS.filter(header => !headers.includes(header)),
  };
}

function exactHttpUrl(value) {
  const candidate = text(value);
  return /^https:\/\/[^\s]+$/i.test(candidate) ? candidate : null;
}

function approvedChild(row) {
  const reasons = [];
  if (!text(row.parent_listing_id) || !text(row.child_listing_id)) reasons.push('CHILD_LINEAGE_MISSING');
  if (!Number.isInteger(Number(row.child_index)) || Number(row.child_index) < 1) reasons.push('CHILD_INDEX_INVALID');
  if (!text(row.child_raw_message)) reasons.push('CHILD_RAW_SEGMENT_MISSING');
  if (!text(row.final_brand) || !text(row.final_model) || !text(row.final_reference)) reasons.push('CHILD_IDENTITY_INCOMPLETE');
  if (!['WTS', 'WTB', 'TRADE'].includes(text(row.listing_type).toUpperCase())) reasons.push('CHILD_LISTING_TYPE_INVALID');
  if (text(row.listing_type).toUpperCase() === 'WTS') {
    if (!text(row.source_price_text) || !(Number(row.source_price_amount) > 0) || !text(row.source_currency)) {
      reasons.push('CHILD_PRICE_ASSOCIATION_INCOMPLETE');
    }
  }
  if (text(row.image_association_status) !== 'EXACT_CHILD_IMAGE') reasons.push('CHILD_IMAGE_ASSOCIATION_UNVERIFIED');
  if (!exactHttpUrl(row.child_image_url)) reasons.push('CHILD_IMAGE_URL_INVALID');
  if (text(row.review_status) !== 'APPROVED_SINGLE_CANDIDATE') reasons.push('CHILD_NOT_APPROVED');
  if (!text(row.reviewed_by) || !text(row.reviewed_at)) reasons.push('CHILD_REVIEW_EVIDENCE_MISSING');
  return reasons;
}

function audit({ admissionPath, normalizedPath, childLedgerPath, brand }) {
  const admission = readWorkbook(admissionPath);
  const normalized = normalizedPath ? readWorkbook(normalizedPath) : null;
  if (admission.sourceRows.length !== admission.decisionRows.length) {
    throw new Error('admission source and decision row counts do not match');
  }
  const parentIds = new Set();
  const counts = {
    input_rows: admission.sourceRows.length,
    bundle_parents: 0,
    bundle_parents_with_no_image: 0,
    bundle_parents_with_one_image: 0,
    bundle_parents_with_multiple_images: 0,
    approved_child_rows: 0,
    held_child_rows: 0,
  };
  for (let index = 0; index < admission.sourceRows.length; index += 1) {
    const source = admission.sourceRows[index];
    const decision = admission.decisionRows[index];
    if (text(source.listing_id) !== text(decision.listing_id)) {
      throw new Error(`source/decision listing order mismatch at row ${index + 2}`);
    }
    if (text(decision.bundle_status) === 'SINGLE_CANDIDATE') continue;
    counts.bundle_parents += 1;
    parentIds.add(text(source.listing_id));
    const imageCount = Number(source.image_count_source || 0);
    if (imageCount < 1) counts.bundle_parents_with_no_image += 1;
    else if (imageCount === 1) counts.bundle_parents_with_one_image += 1;
    else counts.bundle_parents_with_multiple_images += 1;
  }

  const childLedger = readChildLedger(childLedgerPath);
  const heldReasons = {};
  const childIds = new Set();
  for (const row of childLedger.rows) {
    const reasons = approvedChild(row);
    if (!parentIds.has(text(row.parent_listing_id))) reasons.push('PARENT_NOT_IN_BUNDLE_COHORT');
    const childId = text(row.child_listing_id);
    if (childId && childIds.has(childId)) reasons.push('DUPLICATE_CHILD_ID');
    childIds.add(childId);
    if (reasons.length) {
      counts.held_child_rows += 1;
      for (const reason of new Set(reasons)) heldReasons[reason] = (heldReasons[reason] || 0) + 1;
    } else counts.approved_child_rows += 1;
  }

  const admissionHash = sha256(admission.buffer);
  const normalizedHash = normalized ? sha256(normalized.buffer) : null;
  const childContractReady = childLedger.missingHeaders.length === 0;
  const ready = childContractReady && counts.approved_child_rows > 0;
  return {
    mode: 'READ_ONLY_UNBUNDLE_AUDIT',
    brand,
    admission_file: path.basename(admissionPath),
    admission_sha256: admissionHash,
    normalized_file: normalizedPath ? path.basename(normalizedPath) : null,
    normalized_sha256: normalizedHash,
    admission_and_normalized_are_identical: Boolean(normalizedHash && normalizedHash === admissionHash),
    child_ledger_file: childLedgerPath ? path.basename(childLedgerPath) : null,
    child_ledger_missing_headers: childLedger.missingHeaders,
    counts,
    held_child_reasons: heldReasons,
    automatic_parent_image_inheritance_allowed: false,
    publication_ready: ready,
    disposition: ready ? 'APPROVED_CHILD_CANARY_AVAILABLE' : 'HOLD_BUNDLE_PARENTS_PENDING_EXACT_CHILD_LEDGER',
    database_writes: 0,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!args.admission || !args.brand) throw new Error('--admission and --brand are required');
  return {
    admissionPath: path.resolve(args.admission),
    normalizedPath: args.normalized ? path.resolve(args.normalized) : null,
    childLedgerPath: args.children ? path.resolve(args.children) : null,
    brand: text(args.brand),
  };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(audit(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { CHILD_HEADERS, approvedChild, audit };
