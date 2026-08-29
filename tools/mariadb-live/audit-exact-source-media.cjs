'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  atomicJson,
  boundedInteger,
  jsonLine,
  readJsonLines,
} = require('./lib.cjs');
const { proposalFiles, readManifest, stagingRecord } = require('./import-normalized-staging.cjs');

const MEDIA_AUDIT_CONTRACT = 'wf-mariadb-exact-source-media-audit-v1';
const DEFAULT_HOST = 'thecollective-prod.nyc3.digitaloceanspaces.com';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function config(env = process.env) {
  const required = ['MARIADB_MEDIA_RAW_INPUT', 'MARIADB_MEDIA_NORMALIZATION_MANIFEST', 'MARIADB_MEDIA_AUDIT_OUTPUT'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    rawInput: path.resolve(env.MARIADB_MEDIA_RAW_INPUT),
    manifestPath: path.resolve(env.MARIADB_MEDIA_NORMALIZATION_MANIFEST),
    output: path.resolve(env.MARIADB_MEDIA_AUDIT_OUTPUT),
    concurrency: boundedInteger(env.MARIADB_MEDIA_AUDIT_CONCURRENCY, 12, 1, 50, 'MARIADB_MEDIA_AUDIT_CONCURRENCY'),
    limit: boundedInteger(env.MARIADB_MEDIA_AUDIT_LIMIT, 1000000, 1, 2000000, 'MARIADB_MEDIA_AUDIT_LIMIT'),
    timeoutMs: boundedInteger(env.MARIADB_MEDIA_AUDIT_TIMEOUT_MS, 10000, 1000, 30000, 'MARIADB_MEDIA_AUDIT_TIMEOUT_MS'),
    allowedHosts: new Set(String(env.MARIADB_MEDIA_ALLOWED_HOSTS || DEFAULT_HOST)
      .split(',').map(value => value.trim().toLowerCase()).filter(Boolean)),
  };
}

async function* proposals(files) {
  for (const file of files) {
    for await (const line of readJsonLines(file)) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

function validateMediaUrl(value, allowedHosts = new Set([DEFAULT_HOST])) {
  try {
    const supplied = String(value || '');
    const decodedSupplied = decodeURIComponent(supplied);
    if (/(?:^|\/)\.\.(?:\/|$)/.test(decodedSupplied)) {
      return { safe: false, reason: 'UNSAFE_OBJECT_PATH', url: null };
    }
    const url = new URL(supplied);
    const decodedPath = decodeURIComponent(url.pathname);
    const extension = path.posix.extname(decodedPath).toLowerCase();
    if (url.protocol !== 'https:') return { safe: false, reason: 'NON_HTTPS_URL', url: null };
    if (!allowedHosts.has(url.hostname.toLowerCase())) return { safe: false, reason: 'UNAPPROVED_MEDIA_HOST', url: null };
    if (decodedPath.split('/').includes('..')) return { safe: false, reason: 'UNSAFE_OBJECT_PATH', url: null };
    if (!IMAGE_EXTENSIONS.has(extension)) return { safe: false, reason: 'UNSUPPORTED_IMAGE_EXTENSION', url: null };
    url.hash = '';
    return { safe: true, reason: null, url: url.href };
  } catch {
    return { safe: false, reason: 'INVALID_MEDIA_URL', url: null };
  }
}

async function probe(url, fetchImpl = fetch, timeoutMs = 10000) {
  try {
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase() || null;
    if (!response.ok) return { reachable: false, status: response.status, content_type: contentType, reason: 'URL_UNREACHABLE' };
    if (!contentType?.startsWith('image/')) {
      return { reachable: true, status: response.status, content_type: contentType, reason: 'CONTENT_TYPE_UNVERIFIED' };
    }
    return { reachable: true, status: response.status, content_type: contentType, reason: null };
  } catch (error) {
    return { reachable: false, status: null, content_type: null, reason: error?.name === 'TimeoutError' ? 'URL_TIMEOUT' : 'URL_UNREACHABLE' };
  }
}

function ledgerCandidate(record) {
  return {
    contract: MEDIA_AUDIT_CONTRACT,
    source_record_id: record.source_record_id,
    source_hash: record.source_hash,
    source_candidate_hash: record.source_candidate_hash,
    category: record.category,
    brand: record.candidate?.brand || null,
    reference: record.candidate?.reference || null,
    listing_type: record.candidate?.listing_type || null,
    source_media_key: record.media.source_media_key,
    source_media_url_candidate: record.media.source_media_url_candidate,
    exact_source_lineage: record.media.exact_source_lineage === true,
    bundle_status: record.bundle_status,
  };
}

async function auditCandidate(candidate, options = {}) {
  const checked = validateMediaUrl(candidate.source_media_url_candidate, options.allowedHosts);
  if (!checked.safe) {
    return { ...candidate, canonical_url: null, url_reachable: false, http_status: null, content_type: null, recommendation: 'DEFER', reason: checked.reason };
  }
  const result = await probe(checked.url, options.fetchImpl, options.timeoutMs);
  const eligible = candidate.exact_source_lineage === true
    && candidate.bundle_status === 'SINGLE_CANDIDATE'
    && result.reachable
    && !result.reason;
  return {
    ...candidate,
    canonical_url: checked.url,
    url_reachable: result.reachable,
    http_status: result.status,
    content_type: result.content_type,
    recommendation: eligible ? 'SAFE_LINEAGE_CANDIDATE_REVIEW' : 'DEFER',
    reason: eligible ? null : (result.reason || 'LINEAGE_OR_BUNDLE_REVIEW_REQUIRED'),
  };
}

function increment(map, key) {
  const value = key || '<NULL>';
  map[value] = (map[value] || 0) + 1;
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  if (!fs.existsSync(file)) return hash.digest('hex');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function run(options = {}) {
  const runConfig = options.config || config();
  const fetchImpl = options.fetchImpl || fetch;
  const manifestConfig = { rawInput: runConfig.rawInput, manifestPath: runConfig.manifestPath };
  const { manifest, files } = readManifest(manifestConfig);
  if (fs.existsSync(runConfig.output)) throw new Error(`Media audit output already exists: ${runConfig.output}`);
  fs.mkdirSync(runConfig.output, { recursive: false });
  const ledgerPath = path.join(runConfig.output, 'exact-source-media-ledger.jsonl');
  const reportPath = path.join(runConfig.output, 'exact-source-media-report.json');
  const proposalIterator = proposals(proposalFiles(manifest))[Symbol.asyncIterator]();
  const counts = { reasons: {}, recommendations: {}, category: {} };
  let sourceRows = 0;
  let exactMediaRows = 0;
  let noMediaRows = 0;
  let bundleMediaDeferred = 0;
  let auditedMediaRows = 0;
  let safeReviewCandidates = 0;
  let pending = [];

  async function flush() {
    if (!pending.length) return;
    const results = await Promise.all(pending.map(candidate => auditCandidate(candidate, {
      allowedHosts: runConfig.allowedHosts,
      fetchImpl,
      timeoutMs: runConfig.timeoutMs,
    })));
    for (const row of results) {
      fs.appendFileSync(ledgerPath, jsonLine(row));
      auditedMediaRows += 1;
      if (row.recommendation === 'SAFE_LINEAGE_CANDIDATE_REVIEW') safeReviewCandidates += 1;
      increment(counts.recommendations, row.recommendation);
      increment(counts.reasons, row.reason);
      increment(counts.category, row.category);
    }
    pending = [];
  }

  for await (const line of readJsonLines(runConfig.rawInput)) {
    if (!line.trim()) continue;
    const proposalResult = await proposalIterator.next();
    if (proposalResult.done) throw new Error(`Normalization proposals ended before source row ${sourceRows + 1}`);
    const source = JSON.parse(line);
    const record = stagingRecord(source, proposalResult.value);
    sourceRows += 1;
    if (!record.media.exact_source_lineage) {
      noMediaRows += 1;
      continue;
    }
    exactMediaRows += 1;
    if (record.materialization !== 'SINGLE') {
      bundleMediaDeferred += 1;
      continue;
    }
    if (auditedMediaRows + pending.length >= runConfig.limit) continue;
    pending.push(ledgerCandidate(record));
    if (pending.length >= runConfig.concurrency) await flush();
  }
  await flush();
  const extraProposal = await proposalIterator.next();
  if (!extraProposal.done) throw new Error('Normalization proposals contain rows beyond the raw archive');
  if (sourceRows !== Number(manifest.source_rows)) throw new Error(`Media audit source coverage failed: ${sourceRows}/${manifest.source_rows}`);

  const report = {
    contract: MEDIA_AUDIT_CONTRACT,
    generated_at: new Date().toISOString(),
    source_rows: sourceRows,
    exact_source_media_rows: exactMediaRows,
    no_source_media_rows: noMediaRows,
    bundle_media_deferred: bundleMediaDeferred,
    audited_single_media_rows: auditedMediaRows,
    safe_lineage_candidates_for_review: safeReviewCandidates,
    audit_limit: runConfig.limit,
    complete_for_available_single_media: auditedMediaRows === exactMediaRows - bundleMediaDeferred,
    counts,
    ledger_path: ledgerPath,
    ledger_sha256: await hashFile(ledgerPath),
    production_writes: 0,
    public_image_updates: 0,
  };
  atomicJson(reportPath, report);
  return report;
}

if (require.main === module) {
  run().then(report => {
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_exact_source_media_audit_complete', ...report })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_exact_source_media_audit_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      production_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MEDIA_AUDIT_CONTRACT,
  auditCandidate,
  config,
  hashFile,
  ledgerCandidate,
  probe,
  run,
  validateMediaUrl,
};
