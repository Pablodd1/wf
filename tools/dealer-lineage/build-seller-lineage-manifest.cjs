'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const csv = require('csv-parser');
const {
  classifyParent, normalizeIntent, normalizePhone, parseTitleHash, sha1,
  sourcePostedAt, text, wallClock,
} = require('./seller-lineage.cjs');

const CHECKPOINT_INTERVAL = Math.max(1000, Number(process.env.SELLER_LINEAGE_CHECKPOINT_INTERVAL || 25000));

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function appendJsonl(filePath, rows) {
  if (rows.length) fs.appendFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

function resolveParentFiles(inputs) {
  const expanded = [];
  for (const input of inputs.flatMap(value => String(value || '').split(',')).map(value => value.trim()).filter(Boolean)) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) throw new Error(`Parent input not found: ${resolved}`);
    if (fs.statSync(resolved).isDirectory()) {
      expanded.push(...fs.readdirSync(resolved)
        .filter(name => /^unbundle_.*_raw_messages_batch_\d+\.csv$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(name => path.join(resolved, name)));
    } else {
      expanded.push(resolved);
    }
  }
  return [...new Set(expanded)];
}

async function loadParents(parentFiles) {
  const parents = new Map();
  const byHash = new Map();
  for (const filePath of parentFiles) {
    for await (const row of fs.createReadStream(filePath).pipe(csv())) {
      const sourceRecordId = text(row.source_record_id);
      const rawMessage = String(row.raw_message ?? '');
      if (!sourceRecordId || !rawMessage) continue;
      const parent = {
        sourceRecordId,
        sourceFile: path.basename(filePath),
        titleSha1: sha1(rawMessage),
        wallClock: wallClock(row.created_at),
        parentCreatedAt: text(row.created_at) || null,
        intent: normalizeIntent(row.listing_type),
      };
      parents.set(sourceRecordId, parent);
      const ids = byHash.get(parent.titleSha1) || [];
      ids.push(sourceRecordId);
      byHash.set(parent.titleSha1, ids);
    }
  }
  return { parents, byHash };
}

async function scanSellerCsv({ sellerCsv, byHash, candidatePath, checkpointPath, reset }) {
  if (reset) {
    fs.rmSync(candidatePath, { force: true });
    fs.rmSync(checkpointPath, { force: true });
  }
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : {
        sellerRowsProcessed: 0, candidateRowsWritten: 0, timestampedHashCandidates: 0,
        hashOnlyMatches: 0, malformedTitleHashes: 0, invalidPhones: 0, completed: false,
      };
  checkpoint.candidateRowsWritten ||= checkpoint.exactMatchesWritten || 0;
  checkpoint.timestampedHashCandidates ||= 0;
  if (checkpoint.completed) return checkpoint;
  let rowNumber = 0;
  let pending = [];

  for await (const row of fs.createReadStream(sellerCsv).pipe(csv())) {
    rowNumber += 1;
    if (rowNumber <= checkpoint.sellerRowsProcessed) continue;
    const parsedHash = parseTitleHash(row.title_hash);
    if (!parsedHash) {
      checkpoint.malformedTitleHashes += 1;
    } else if (byHash.has(parsedHash.titleSha1)) {
      const phone = normalizePhone(row.from_number);
      if (!phone || phone !== parsedHash.phone) {
        checkpoint.invalidPhones += 1;
      } else {
        const sellerWallClock = wallClock(row.created_on);
        for (const sourceRecordId of byHash.get(parsedHash.titleSha1)) {
          const record = {
            sourceRecordId,
            sellerListingId: text(row.id),
            origin: text(row.origin) || null,
            sourceListingType: text(row.type) || null,
            sourceIntent: normalizeIntent(row.type),
            observedName: text(row.from_name) || null,
            phoneCode: text(row.phone_code) || null,
            phone,
            titleSha1: parsedHash.titleSha1,
            titleHash: text(row.title_hash),
            frontImage: text(row.front_image) || null,
            sourcePostedAtRaw: text(row.created_on) || null,
            sourcePostedAt: sourcePostedAt(row.created_on),
            sourceWallClock: sellerWallClock,
          };
          pending.push(record);
          if (sellerWallClock) checkpoint.timestampedHashCandidates += 1;
        }
      }
    }
    checkpoint.sellerRowsProcessed = rowNumber;
    if (rowNumber % CHECKPOINT_INTERVAL === 0) {
      appendJsonl(candidatePath, pending);
      checkpoint.candidateRowsWritten += pending.length;
      pending = [];
      checkpoint.updatedAt = new Date().toISOString();
      atomicJson(checkpointPath, checkpoint);
      process.stdout.write(`${JSON.stringify({ event: 'seller_lineage_scan_checkpoint', ...checkpoint })}\n`);
    }
  }
  appendJsonl(candidatePath, pending);
  checkpoint.candidateRowsWritten += pending.length;
  checkpoint.completed = true;
  checkpoint.updatedAt = new Date().toISOString();
  atomicJson(checkpointPath, checkpoint);
  return checkpoint;
}

async function loadCandidates(candidatePath, parents) {
  const exactByParent = new Map();
  const hashOnlyByParent = new Map();
  if (!fs.existsSync(candidatePath)) return { exactByParent, hashOnlyByParent };
  for await (const line of readline.createInterface({ input: fs.createReadStream(candidatePath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const candidate = JSON.parse(line);
    const parent = parents.get(candidate.sourceRecordId);
    if (!parent) continue;
    if (candidate.sourceWallClock && candidate.sourceWallClock === parent.wallClock) {
      const rows = exactByParent.get(parent.sourceRecordId) || [];
      rows.push(candidate);
      exactByParent.set(parent.sourceRecordId, rows);
    } else {
      hashOnlyByParent.set(parent.sourceRecordId, (hashOnlyByParent.get(parent.sourceRecordId) || 0) + 1);
    }
  }
  return { exactByParent, hashOnlyByParent };
}

function publicManifestRow(parent, result) {
  const first = result.candidates?.[0];
  return {
    source_system: 'UNBUNDLED_RAW_MESSAGE',
    source_record_id: parent.sourceRecordId,
    source_file: parent.sourceFile,
    seller_listing_id: first?.sellerListingId || null,
    seller_phone_normalized: result.phone || null,
    observed_names: result.observedNames || [],
    origin: first?.origin || null,
    source_listing_type: first?.sourceListingType || null,
    source_intent: first?.sourceIntent || null,
    normalized_intent: parent.intent,
    source_posted_at: first?.sourcePostedAt || null,
    source_posted_at_raw: first?.sourcePostedAtRaw || null,
    parent_created_at: parent.parentCreatedAt,
    title_sha1: parent.titleSha1,
    front_image: first?.frontImage || null,
    match_status: result.classification,
    match_evidence: {
      exact_raw_message_sha1: true,
      exact_wall_clock_second: true,
      unique_phone_identity: Boolean(result.phone),
      intent_agreement: first?.sourceIntent === parent.intent,
      source_candidate_count: result.candidates?.length || 0,
      hash_only_timestamp_mismatches: result.hashOnlyCount || 0,
      reason_codes: result.reasonCodes,
    },
  };
}

async function buildManifests({ sellerCsv, parentFiles, outputDir, reset = false }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const candidatePath = path.join(outputDir, 'seller-candidates.jsonl');
  const checkpointPath = path.join(outputDir, 'scan-checkpoint.json');
  if (reset) {
    for (const name of ['match-ready.jsonl', 'review-required.jsonl', 'unmatched-parents.jsonl', 'canary-100.jsonl', 'report.json']) {
      fs.rmSync(path.join(outputDir, name), { force: true });
    }
  }
  const { parents, byHash } = await loadParents(parentFiles);
  if (!parents.size) throw new Error('No parent records were loaded');
  const scan = await scanSellerCsv({ sellerCsv, byHash, candidatePath, checkpointPath, reset });
  const { exactByParent, hashOnlyByParent } = await loadCandidates(candidatePath, parents);
  const ready = [];
  const review = [];
  const unmatched = [];
  const reasonCounts = {};
  let missingNames = 0;
  let withFrontImage = 0;

  for (const parent of parents.values()) {
    const result = classifyParent(parent, exactByParent.get(parent.sourceRecordId) || [], hashOnlyByParent.get(parent.sourceRecordId) || 0);
    for (const reason of result.reasonCodes) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if (result.classification === 'C_UNMATCHED') {
      unmatched.push({
        source_record_id: parent.sourceRecordId,
        source_file: parent.sourceFile,
        title_sha1: parent.titleSha1,
        parent_created_at: parent.parentCreatedAt,
        normalized_intent: parent.intent,
        reason_codes: result.reasonCodes,
        hash_only_timestamp_mismatches: result.hashOnlyCount,
      });
      continue;
    }
    const manifest = publicManifestRow(parent, result);
    if (!manifest.observed_names.length) missingNames += 1;
    if (manifest.front_image) withFrontImage += 1;
    if (result.classification === 'A_AUTO_STAGE') ready.push(manifest);
    else review.push(manifest);
  }

  const readyPath = path.join(outputDir, 'match-ready.jsonl');
  const reviewPath = path.join(outputDir, 'review-required.jsonl');
  const unmatchedPath = path.join(outputDir, 'unmatched-parents.jsonl');
  for (const filePath of [readyPath, reviewPath, unmatchedPath]) fs.rmSync(filePath, { force: true });
  appendJsonl(readyPath, ready);
  appendJsonl(reviewPath, review);
  appendJsonl(unmatchedPath, unmatched);
  const canary = ready.slice().sort((a, b) => a.source_record_id.localeCompare(b.source_record_id)).slice(0, 100);
  const canaryPath = path.join(outputDir, 'canary-100.jsonl');
  fs.rmSync(canaryPath, { force: true });
  appendJsonl(canaryPath, canary);
  const report = {
    generatedAt: new Date().toISOString(),
    sellerCsv: path.basename(sellerCsv),
    parentFiles: parentFiles.map(filePath => path.basename(filePath)),
    parentRows: parents.size,
    sellerRowsScanned: scan.sellerRowsProcessed,
    matchReady: ready.length,
    reviewRequired: review.length,
    unmatched: unmatched.length,
    canaryRows: canary.length,
    matchedRowsMissingName: missingNames,
    matchedRowsWithFrontImage: withFrontImage,
    reasonCounts,
    productionWrites: 0,
    publicContactChanges: 0,
  };
  atomicJson(path.join(outputDir, 'report.json'), report);
  return report;
}

async function main() {
  const sellerCsv = path.resolve(process.env.SELLER_LISTING_CSV || process.argv[2] || '');
  if (!sellerCsv || !fs.existsSync(sellerCsv)) throw new Error('SELLER_LISTING_CSV must point to the seller listing CSV');
  const inputs = process.argv.slice(3);
  if (process.env.UNBUNDLED_PARENT_CSV_PATHS) inputs.push(process.env.UNBUNDLED_PARENT_CSV_PATHS);
  if (process.env.UNBUNDLED_PARENT_DIR) inputs.push(process.env.UNBUNDLED_PARENT_DIR);
  const parentFiles = resolveParentFiles(inputs);
  if (!parentFiles.length) throw new Error('Provide one or more parent CSV files or a directory');
  const outputDir = path.resolve(process.env.SELLER_LINEAGE_OUTPUT || 'audit-output/dealer-lineage/seller-lineage');
  const reset = String(process.env.SELLER_LINEAGE_RESET || 'false').toLowerCase() === 'true';
  const report = await buildManifests({ sellerCsv, parentFiles, outputDir, reset });
  process.stdout.write(`${JSON.stringify({ event: 'seller_lineage_manifest_complete', ...report }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'seller_lineage_manifest_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { buildManifests, loadCandidates, loadParents, resolveParentFiles };
