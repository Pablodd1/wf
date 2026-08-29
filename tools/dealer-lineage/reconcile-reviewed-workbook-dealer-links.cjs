'use strict';

// Dry-run by default. This tool reads approved admission workbooks and the
// private canonical directory, then creates only exact, unique VERIFIED
// PHONE/WHATSAPP -> VERIFIED dealer link candidates. It never copies a phone
// into the reviewed inventory, the link sidecar, or the public API.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  PRICE_RESEARCH_ONLY_REASONS,
  additionalImportReasons,
  admissionIdentityGateReasons,
  canonicalizeExactDuplicates,
  classifyOwnerUnbundledRow,
  readAdmissionWorkbook,
  rowForImport,
} = require('../intake/import-approved-admission-workbook.cjs');

const LINK_TABLE = 'reviewed_workbook_dealer_links';
const SOURCE_SYSTEM = 'OWNER_ADMISSION_WORKBOOK';
const LINK_METHOD = 'EXACT_VERIFIED_PHONE';
const PHONE_IDENTITY_TYPES = new Set(['PHONE', 'WHATSAPP']);

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizePhone(value) {
  const digits = text(value).replace(/[^0-9]/g, '');
  return /^[0-9]{8,15}$/.test(digits) ? digits : null;
}

function sha256(value) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(value)) hash.update(value);
  else hash.update(String(value), 'utf8');
  return hash.digest('hex');
}

function evidenceDigest(value, key) {
  if (!key || String(key).length < 32) {
    throw new Error('LINK_EVIDENCE_HMAC_KEY must contain at least 32 characters');
  }
  return crypto.createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function buildVerifiedIdentityIndex(identityRows, verifiedDealerIds) {
  const index = new Map();
  const verified = new Set([...verifiedDealerIds].map(String));
  for (const row of identityRows || []) {
    const dealerId = text(row?.dealer_id);
    const identityType = text(row?.identity_type).toUpperCase();
    if (text(row?.verification_status).toUpperCase() !== 'VERIFIED') continue;
    if (!PHONE_IDENTITY_TYPES.has(identityType) || !verified.has(dealerId)) continue;
    const identity = normalizePhone(row?.source_identity);
    if (!identity) continue;
    const dealerIds = index.get(identity) || new Set();
    dealerIds.add(dealerId);
    index.set(identity, dealerIds);
  }
  return index;
}

function reconcileCandidates(candidates, identityIndex, options = {}) {
  const hmacKey = options.hmacKey || 'test-only-evidence-hmac-key-0000000000';
  const matched = [];
  const held = [];
  for (const candidate of candidates || []) {
    const identity = normalizePhone(candidate?.seller_source_id);
    if (!identity) {
      held.push({ reviewed_listing_id: candidate.reviewed_listing_id, reason: 'INVALID_OR_MISSING_SOURCE_IDENTITY' });
      continue;
    }
    const dealerIds = [...(identityIndex.get(identity) || [])].sort();
    if (dealerIds.length === 0) {
      held.push({ reviewed_listing_id: candidate.reviewed_listing_id, reason: 'NO_UNIQUE_VERIFIED_IDENTITY_MATCH' });
      continue;
    }
    if (dealerIds.length !== 1) {
      held.push({
        reviewed_listing_id: candidate.reviewed_listing_id,
        reason: 'CONFLICTING_VERIFIED_IDENTITY_MATCHES',
        candidate_dealer_ids: dealerIds,
      });
      continue;
    }
    matched.push({
      reviewed_listing_id: candidate.reviewed_listing_id,
      dealer_id: dealerIds[0],
      source_system: SOURCE_SYSTEM,
      link_method: LINK_METHOD,
      link_status: 'APPLIED',
      evidence: {
        source_identity_hmac_sha256: evidenceDigest(identity, hmacKey),
        source_file_sha256: candidate.source_file_sha256,
        source_row_number: candidate.source_row_number,
        source_record_id_sha256: candidate.source_record_id_sha256,
        verification_basis: 'UNIQUE_VERIFIED_PHONE_OR_WHATSAPP_TO_VERIFIED_DEALER',
      },
      updated_at: new Date().toISOString(),
    });
  }
  return { matched, held };
}

function buildWorkbookCandidates(filePath, brand, options = {}) {
  const workbook = readAdmissionWorkbook(filePath);
  const sourceByRecordId = new Map();
  const rows = [];
  workbook.sourceRows.forEach((source, index) => {
    const listingId = text(source.listing_id);
    const decision = workbook.decisions.get(listingId);
    if (!decision) return;
    sourceByRecordId.set(listingId, { source, rowNumber: index + 2 });
    if (options.ownerUnbundled === true) {
      const admission = classifyOwnerUnbundledRow(source, decision, brand);
      const reasons = [
        ...admission.reasons.filter(reason => !PRICE_RESEARCH_ONLY_REASONS.has(reason)),
        ...additionalImportReasons(source, { allowNoImage: true, ownerUnbundled: true }),
        ...admissionIdentityGateReasons(source, decision, brand),
      ];
      if (!admission.trading_floor_candidate || reasons.length) return;
    }
    const imported = rowForImport({
      source,
      decision,
      expectedBrand: brand,
      fileName: path.basename(filePath),
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId: options.runId || 'dealer_link_dry_run',
      ownerUnbundled: options.ownerUnbundled === true,
    });
    if (imported) rows.push(imported);
  });
  const unique = canonicalizeExactDuplicates(rows).canonical;
  return unique.map(row => {
    const sourceEntry = sourceByRecordId.get(text(row.source_record_id));
    return {
      reviewed_listing_id: row.id,
      seller_source_id: sourceEntry?.source?.seller_source_id || null,
      source_file_sha256: row.source_file_sha256,
      source_row_number: row.source_row_number,
      source_record_id_sha256: sha256(row.source_record_id || ''),
    };
  });
}

async function fetchAll(client, table, columns, configure = query => query) {
  const rows = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    let query = client.from(table).select(columns).range(start, start + pageSize - 1);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.brand) throw new Error('--input and --brand are required');
  return {
    input: path.resolve(values.input),
    brand: text(values.brand),
    output: path.resolve(values.output || path.join('audit-output', `reviewed-dealer-link-${Date.now()}.json`)),
    ownerUnbundled: values['unbundled-no-image'] === 'true',
    apply: process.env.APPLY_REVIEWED_WORKBOOK_DEALER_LINKS === 'true',
  };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!process.env.SUPABASE_URL || !serviceKey) {
    throw new Error('Supabase server credentials are required for private directory reads');
  }
  if (options.apply && process.env.REVIEWED_WORKBOOK_DEALER_LINK_TABLE !== LINK_TABLE) {
    throw new Error(`REVIEWED_WORKBOOK_DEALER_LINK_TABLE must equal ${LINK_TABLE}`);
  }
  const hmacKey = process.env.LINK_EVIDENCE_HMAC_KEY;
  if (!hmacKey || hmacKey.length < 32) {
    throw new Error('LINK_EVIDENCE_HMAC_KEY must contain at least 32 characters');
  }
  const client = createClient(process.env.SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
  const [dealers, identities] = await Promise.all([
    fetchAll(client, 'dealers', 'id,status', query => query.eq('status', 'VERIFIED')),
    fetchAll(
      client,
      'dealer_source_identities',
      'dealer_id,source_identity,identity_type,verification_status',
      query => query.eq('verification_status', 'VERIFIED'),
    ),
  ]);
  const candidates = buildWorkbookCandidates(options.input, options.brand, {
    ownerUnbundled: options.ownerUnbundled,
  });
  const verifiedDealerIds = new Set(dealers.map(row => String(row.id)));
  const identityIndex = buildVerifiedIdentityIndex(identities, verifiedDealerIds);
  const reconciliation = reconcileCandidates(candidates, identityIndex, { hmacKey });
  let writes = 0;
  if (options.apply && reconciliation.matched.length) {
    for (let start = 0; start < reconciliation.matched.length; start += 200) {
      const batch = reconciliation.matched.slice(start, start + 200);
      const { data, error } = await client
        .from(LINK_TABLE)
        .upsert(batch, { onConflict: 'reviewed_listing_id' })
        .select('reviewed_listing_id');
      if (error) throw error;
      writes += (data || []).length;
    }
    const expectedById = new Map(reconciliation.matched.map(row => [row.reviewed_listing_id, row]));
    const { data: readback, error: readbackError } = await client.from(LINK_TABLE)
      .select('reviewed_listing_id,dealer_id,source_system,link_method,link_status,evidence')
      .in('reviewed_listing_id', [...expectedById.keys()]);
    if (readbackError) throw readbackError;
    if ((readback || []).length !== expectedById.size) throw new Error('dealer link exact-ID readback count mismatch');
    for (const actual of readback || []) {
      const expected = expectedById.get(actual.reviewed_listing_id);
      if (!expected
        || actual.dealer_id !== expected.dealer_id
        || actual.source_system !== SOURCE_SYSTEM
        || actual.link_method !== LINK_METHOD
        || actual.link_status !== 'APPLIED'
        || Object.entries(expected.evidence).some(([key, value]) => actual.evidence?.[key] !== value)
        || Object.keys(actual.evidence || {}).length !== Object.keys(expected.evidence).length) {
        throw new Error(`dealer link exact-ID readback mismatch for ${actual.reviewed_listing_id}`);
      }
      if (Object.keys(actual.evidence || {}).some(key => /phone|whatsapp|source_identity$|seller_source_id|contact/i.test(key)
        && key !== 'source_identity_hmac_sha256')) {
        throw new Error(`dealer link evidence contains forbidden contact key for ${actual.reviewed_listing_id}`);
      }
    }
  }
  const heldReasons = {};
  for (const row of reconciliation.held) heldReasons[row.reason] = (heldReasons[row.reason] || 0) + 1;
  const report = {
    mode: options.apply ? 'SERVICE_ONLY_APPLY' : 'READ_ONLY_DRY_RUN',
    brand: options.brand,
    source_file_sha256: sha256(fs.readFileSync(options.input)),
    reviewed_candidates: candidates.length,
    exact_unique_verified_matches: reconciliation.matched.length,
    held: reconciliation.held.length,
    held_reasons: heldReasons,
    link_candidates: reconciliation.matched,
    held_records: reconciliation.held,
    writes,
    privacy: {
      raw_contact_exported: false,
      public_contact_changed: false,
      evidence_identity: 'HMAC_SHA256_ONLY',
    },
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  const { link_candidates: _linkCandidates, held_records: _heldRecords, ...consoleReport } = report;
  process.stdout.write(`${JSON.stringify(consoleReport, null, 2)}\n`);
  return report;
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = {
  LINK_METHOD,
  LINK_TABLE,
  PHONE_IDENTITY_TYPES,
  SOURCE_SYSTEM,
  buildVerifiedIdentityIndex,
  buildWorkbookCandidates,
  evidenceDigest,
  normalizePhone,
  reconcileCandidates,
  run,
};
