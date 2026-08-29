'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  atomicJson,
  jsonLine,
  readJsonLines,
  sha256,
  stableJson,
} = require('./lib.cjs');
const { buildPublicationReview } = require('./publication-review.cjs');
const { priorityFamily } = require('./audit-publication-readiness.cjs');
const { proposalFiles, readManifest } = require('./import-normalized-staging.cjs');

const PRIORITY_REVIEW_CONTRACT = 'wf-mariadb-priority-reference-review-v1';

function config(env = process.env) {
  const required = ['MARIADB_PRIORITY_RAW_INPUT', 'MARIADB_PRIORITY_NORMALIZATION_MANIFEST', 'MARIADB_PRIORITY_REVIEW_OUTPUT'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    rawInput: path.resolve(env.MARIADB_PRIORITY_RAW_INPUT),
    manifestPath: path.resolve(env.MARIADB_PRIORITY_NORMALIZATION_MANIFEST),
    output: path.resolve(env.MARIADB_PRIORITY_REVIEW_OUTPUT),
  };
}

async function* proposals(files) {
  for (const file of files) {
    for await (const line of readJsonLines(file)) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

function normalizedText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

function sellerIdentityHash(source) {
  const raw = source.raw_data || {};
  const identity = normalizedText(raw.from_number || raw.company_id || raw.from_name);
  return identity ? sha256(identity) : null;
}

function priorityReviewRow(source, proposal) {
  const review = buildPublicationReview(source, proposal);
  const family = priorityFamily(review.candidate?.reference, review.candidate?.brand);
  if (!family) return null;
  const candidate = review.candidate;
  const sellerHash = sellerIdentityHash(source);
  const rawMessageHash = sha256(source.raw_message || '');
  const exactDuplicateFingerprint = sha256(stableJson({ seller_identity_hash: sellerHash, raw_message_sha256: rawMessageHash }));
  const offerFingerprint = sha256(stableJson({
    seller_identity_hash: sellerHash,
    family,
    brand: normalizedText(candidate?.brand),
    reference: normalizedText(candidate?.reference),
    dial: normalizedText(candidate?.dial_color),
    condition: normalizedText(candidate?.condition),
    intent: candidate?.listing_type || null,
    amount: candidate?.price?.amount_original ?? null,
    currency: candidate?.price?.currency_original || null,
  }));
  return {
    contract: PRIORITY_REVIEW_CONTRACT,
    private_review_artifact: true,
    source_record_id: review.source_record_id,
    source_hash: review.source_hash,
    source_created_on: review.source_created_on,
    raw_message: review.raw_message,
    raw_message_sha256: rawMessageHash,
    priority_family: family,
    bundle_status: review.bundle_status,
    category: review.category,
    review_disposition: review.review_disposition,
    review_reasons: review.review_reasons,
    trading_floor_status: review.trading_floor_status,
    price_research_status: review.price_research_status,
    candidate,
    catalog_confirmation: proposal.catalog_confirmation || null,
    media: review.media,
    seller: {
      name: review.seller.public.name,
      location: review.seller.public.location,
      seller_identity_hash: sellerHash,
      contact_publication_approved: false,
      rating: null,
      rating_publication_status: 'UNVERIFIED_SOURCE_FIELD',
    },
    exact_duplicate_fingerprint: exactDuplicateFingerprint,
    offer_fingerprint: offerFingerprint,
    human_review_decision: null,
    publication_authorized: false,
  };
}

function increment(map, key) {
  const value = key || '<NULL>';
  map[value] = (map[value] || 0) + 1;
}

async function run(options = {}) {
  const runConfig = options.config || config();
  const { manifest } = readManifest({ rawInput: runConfig.rawInput, manifestPath: runConfig.manifestPath });
  if (fs.existsSync(runConfig.output)) throw new Error(`Priority review output already exists: ${runConfig.output}`);
  fs.mkdirSync(runConfig.output, { recursive: false });
  const packetPath = path.join(runConfig.output, 'priority-reference-private-review.jsonl');
  const reportPath = path.join(runConfig.output, 'priority-reference-review-report.json');
  const proposalIterator = proposals(proposalFiles(manifest))[Symbol.asyncIterator]();
  const counts = { family: {}, intent: {}, trading_floor_status: {}, price_research_status: {}, bundle_status: {} };
  const duplicateCounts = new Map();
  const offerCounts = new Map();
  let sourceRows = 0;
  let priorityRows = 0;

  for await (const line of readJsonLines(runConfig.rawInput)) {
    if (!line.trim()) continue;
    const proposalResult = await proposalIterator.next();
    if (proposalResult.done) throw new Error(`Normalization proposals ended before source row ${sourceRows + 1}`);
    const source = JSON.parse(line);
    sourceRows += 1;
    const row = priorityReviewRow(source, proposalResult.value);
    if (!row) continue;
    fs.appendFileSync(packetPath, jsonLine(row));
    priorityRows += 1;
    increment(counts.family, row.priority_family);
    increment(counts.intent, row.candidate?.listing_type);
    increment(counts.trading_floor_status, row.trading_floor_status);
    increment(counts.price_research_status, row.price_research_status);
    increment(counts.bundle_status, row.bundle_status);
    duplicateCounts.set(row.exact_duplicate_fingerprint, (duplicateCounts.get(row.exact_duplicate_fingerprint) || 0) + 1);
    offerCounts.set(row.offer_fingerprint, (offerCounts.get(row.offer_fingerprint) || 0) + 1);
  }
  const extraProposal = await proposalIterator.next();
  if (!extraProposal.done) throw new Error('Normalization proposals contain rows beyond the raw archive');
  if (sourceRows !== Number(manifest.source_rows)) throw new Error(`Priority review source coverage failed: ${sourceRows}/${manifest.source_rows}`);

  const report = {
    contract: PRIORITY_REVIEW_CONTRACT,
    generated_at: new Date().toISOString(),
    private_review_artifact: true,
    source_rows: sourceRows,
    priority_rows: priorityRows,
    counts,
    repeated_exact_duplicate_groups: [...duplicateCounts.values()].filter(count => count > 1).length,
    repeated_offer_groups: [...offerCounts.values()].filter(count => count > 1).length,
    packet_path: packetPath,
    production_writes: 0,
    publication_authorized_rows: 0,
  };
  atomicJson(reportPath, report);
  return report;
}

if (require.main === module) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_priority_reference_review_complete', ...report })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_priority_reference_review_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      production_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRIORITY_REVIEW_CONTRACT,
  normalizedText,
  priorityReviewRow,
  run,
  sellerIdentityHash,
};
