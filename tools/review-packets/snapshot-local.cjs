'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { proposalSha256, sha256, stableValue } = require('../../api/_lib/review-packets.cjs');

const DEFAULT_OUTPUT = path.resolve('audit-output/review-packet-snapshot');
const SHA256 = /^[a-f0-9]{64}$/i;
const REASON = /^[A-Z][A-Z0-9_]{1,79}$/;
const REASON_PRIORITY = [
  'NO_CANDIDATE',
  'CURRENCY_AMBIGUOUS',
  'EMOJI_PRICE_AMBIGUOUS',
  'PRICE_PARSE_FAILED',
  'DIAL_AMBIGUOUS',
  'BUNDLE_SPLIT_REQUIRED',
];
const PRIVATE_KEYS = /(?:raw_message|raw_line|seller|phone|contact|email|source_identity|observed_name)/i;

function parseInteger(value, fallback, minimum, maximum, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function sanitizeProposal(value) {
  if (Array.isArray(value)) return value.map(sanitizeProposal);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.test(key)) {
      if (/^raw_(?:message|line)$/i.test(key) && child != null) output[`${key}_sha256`] = sha256(child);
      continue;
    }
    output[key] = sanitizeProposal(child);
  }
  return output;
}

function frozenProposal(row) {
  const supplied = row.frozen_proposal ?? row.frozenProposal;
  const proposal = supplied && typeof supplied === 'object' && !Array.isArray(supplied)
    ? supplied
    : {
        candidate_count: Number(row.candidate_count ?? row.candidateCount ?? 0),
        proposed_candidates: Array.isArray(row.proposed_candidates)
          ? row.proposed_candidates
          : Array.isArray(row.proposedCandidates) ? row.proposedCandidates : [],
        change_flags: Array.isArray(row.change_flags)
          ? row.change_flags
          : Array.isArray(row.changeFlags) ? row.changeFlags : [],
      };
  return stableValue(sanitizeProposal(proposal));
}

function exclusiveReason(row) {
  const explicit = String(row.reason || '').trim().toUpperCase();
  if (explicit) {
    if (!REASON.test(explicit)) throw new Error('reason must be one uppercase reason code');
    return explicit;
  }
  const reasons = new Set([
    ...(Array.isArray(row.review_reasons) ? row.review_reasons : []),
    ...(Array.isArray(row.reviewReasons) ? row.reviewReasons : []),
    ...(Array.isArray(row.change_flags) ? row.change_flags : []),
    ...(Array.isArray(row.changeFlags) ? row.changeFlags : []),
  ].map(value => String(value || '').trim().toUpperCase()).filter(Boolean));
  return REASON_PRIORITY.find(reason => reasons.has(reason)) || 'DETERMINISTIC_CHANGE_REVIEW';
}

function rawMessageSha256(row) {
  const supplied = String(row.raw_message_sha256 || row.rawMessageSha256 || '').trim().toLowerCase();
  if (supplied) {
    if (!SHA256.test(supplied)) throw new Error('raw_message_sha256 must be a SHA-256 value');
    return supplied;
  }
  if (typeof row.raw_message !== 'string' && typeof row.rawMessage !== 'string') {
    throw new Error('raw_message or raw_message_sha256 is required');
  }
  return sha256(row.raw_message ?? row.rawMessage);
}

function normalizeRow(row, state, options) {
  const sourceRecordId = String(row.source_record_id || row.sourceRecordId || '').trim();
  const normalizationVersion = String(row.normalization_version || row.normalizationVersion || '').trim();
  const status = String(row.review_status || row.status || 'PENDING').trim().toUpperCase();
  if (!sourceRecordId || sourceRecordId.length > 300) throw new Error('source_record_id is required');
  if (!normalizationVersion || normalizationVersion.length > 120) throw new Error('normalization_version is required');
  if (status !== 'PENDING') throw new Error('only PENDING routing rows can be snapshotted');
  const membershipKey = `${sourceRecordId}\u0000${normalizationVersion}`;
  if (state.seen.has(membershipKey)) throw new Error('duplicate source_record_id and normalization_version');

  const reason = exclusiveReason(row);
  const priorVersion = state.normalizationVersionsByReason[reason];
  if (priorVersion && priorVersion !== normalizationVersion) {
    throw new Error('one packet reason cannot mix normalization versions');
  }
  const reasonIndex = state.reasonCounts[reason] || 0;
  const packetNumber = Math.floor(reasonIndex / options.packetSize) + 1;
  const ordinal = (reasonIndex % options.packetSize) + 1;
  const reasonSlug = reason.toLowerCase();
  const packetId = `rp_${options.inputSha256.slice(0, 12)}_${reasonSlug}_${String(packetNumber).padStart(4, '0')}`;
  const proposal = frozenProposal(row);
  const proposalHash = proposalSha256(proposal);
  const rawHash = rawMessageSha256(row);
  const itemId = `ri_${sha256(`${packetId}|${ordinal}|${sourceRecordId}|${normalizationVersion}`).slice(0, 40)}`;

  state.seen.add(membershipKey);
  state.reasonCounts[reason] = reasonIndex + 1;
  state.normalizationVersionsByReason[reason] = normalizationVersion;
  state.outputRows += 1;
  return {
    id: itemId,
    packet_id: packetId,
    ordinal,
    source_record_id: sourceRecordId,
    normalization_version: normalizationVersion,
    frozen_proposal: proposal,
    proposal_sha256: proposalHash,
    raw_message_sha256: rawHash,
    status,
  };
}

function packetRows(reasonCounts, options) {
  const rows = [];
  for (const reason of Object.keys(reasonCounts).sort()) {
    const total = reasonCounts[reason];
    for (let offset = 0; offset < total; offset += options.packetSize) {
      const number = Math.floor(offset / options.packetSize) + 1;
      rows.push({
        id: `rp_${options.inputSha256.slice(0, 12)}_${reason.toLowerCase()}_${String(number).padStart(4, '0')}`,
        reason,
        normalization_version: options.normalizationVersionsByReason[reason],
        source_artifact_sha256: options.inputSha256,
        status: 'READY_FOR_REVIEW',
        item_count: Math.min(options.packetSize, total - offset),
      });
    }
  }
  return rows;
}

function rebuildSeen(itemsPath) {
  const seen = new Set();
  if (!fs.existsSync(itemsPath)) return seen;
  for (const line of fs.readFileSync(itemsPath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const row = JSON.parse(line);
    seen.add(`${row.source_record_id}\u0000${row.normalization_version}`);
  }
  return seen;
}

async function runSnapshot(inputOptions = {}) {
  const input = path.resolve(inputOptions.input || process.env.REVIEW_PACKET_INPUT || '');
  if (!inputOptions.input && !process.env.REVIEW_PACKET_INPUT) throw new Error('REVIEW_PACKET_INPUT is required');
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error('REVIEW_PACKET_INPUT must be a local file');
  const output = path.resolve(inputOptions.output || process.env.REVIEW_PACKET_OUTPUT || DEFAULT_OUTPUT);
  const maxRows = parseInteger(inputOptions.maxRows ?? process.env.REVIEW_PACKET_MAX_ROWS, 100_000, 1, 100_000, 'maxRows');
  const packetSize = parseInteger(inputOptions.packetSize ?? process.env.REVIEW_PACKET_SIZE, 250, 1, 500, 'packetSize');
  const checkpointEvery = parseInteger(inputOptions.checkpointEvery, 1000, 1, 5000, 'checkpointEvery');
  const inputSha256 = fileSha256(input);
  const outputArtifacts = [
    'packet-items.jsonl',
    'errors.jsonl',
    'checkpoint.json',
    'packets.jsonl',
    'reconciliation.json',
    'manifest.json',
  ].map(name => path.join(output, name));
  if (outputArtifacts.includes(input)) {
    throw new Error('REVIEW_PACKET_INPUT cannot be one of the snapshot output files');
  }
  fs.mkdirSync(output, { recursive: true });

  const itemsPath = path.join(output, 'packet-items.jsonl');
  const errorsPath = path.join(output, 'errors.jsonl');
  const checkpointPath = path.join(output, 'checkpoint.json');
  let checkpoint = {
    contract: 'normalization-review-packet-snapshot-v1',
    input: path.basename(input),
    input_sha256: inputSha256,
    max_rows: maxRows,
    packet_size: packetSize,
    input_lines: 0,
    output_rows: 0,
    error_rows: 0,
    item_bytes: 0,
    error_bytes: 0,
    reason_counts: {},
    normalization_versions_by_reason: {},
    complete: false,
  };
  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (checkpoint.input_sha256 !== inputSha256 || checkpoint.complete) {
      throw new Error(checkpoint.complete ? 'Snapshot is already complete' : 'Checkpoint input hash does not match');
    }
    if (checkpoint.packet_size !== packetSize) {
      throw new Error('Checkpoint packetSize does not match');
    }
    checkpoint.max_rows = maxRows;
    if (fs.existsSync(itemsPath)) fs.truncateSync(itemsPath, checkpoint.item_bytes);
    if (fs.existsSync(errorsPath)) fs.truncateSync(errorsPath, checkpoint.error_bytes);
  } else {
    fs.writeFileSync(itemsPath, '');
    fs.writeFileSync(errorsPath, '');
    atomicJson(checkpointPath, checkpoint);
  }

  const state = {
    seen: rebuildSeen(itemsPath),
    reasonCounts: { ...checkpoint.reason_counts },
    outputRows: checkpoint.output_rows,
    errorRows: checkpoint.error_rows,
    inputLines: checkpoint.input_lines,
    normalizationVersionsByReason: { ...checkpoint.normalization_versions_by_reason },
  };
  const options = { packetSize, inputSha256, normalizationVersionsByReason: state.normalizationVersionsByReason };
  let itemBuffer = [];
  let errorBuffer = [];

  function flush() {
    if (itemBuffer.length) fs.appendFileSync(itemsPath, `${itemBuffer.map(row => JSON.stringify(row)).join('\n')}\n`);
    if (errorBuffer.length) fs.appendFileSync(errorsPath, `${errorBuffer.map(row => JSON.stringify(row)).join('\n')}\n`);
    itemBuffer = [];
    errorBuffer = [];
    checkpoint = {
      ...checkpoint,
      input_lines: state.inputLines,
      output_rows: state.outputRows,
      error_rows: state.errorRows,
      item_bytes: fs.statSync(itemsPath).size,
      error_bytes: fs.statSync(errorsPath).size,
      reason_counts: state.reasonCounts,
      normalization_versions_by_reason: state.normalizationVersionsByReason,
      updated_at: new Date().toISOString(),
    };
    atomicJson(checkpointPath, checkpoint);
  }

  const lines = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
  let physicalLine = 0;
  for await (const line of lines) {
    physicalLine += 1;
    if (physicalLine <= checkpoint.input_lines) continue;
    if (!line.trim()) {
      state.inputLines = physicalLine;
      continue;
    }
    if (state.outputRows + state.errorRows >= maxRows) {
      lines.close();
      throw new Error(`Input exceeds bounded maxRows=${maxRows}`);
    }
    state.inputLines = physicalLine;
    try {
      const parsed = JSON.parse(line);
      const item = normalizeRow(parsed, state, options);
      itemBuffer.push(item);
    } catch (error) {
      state.errorRows += 1;
      errorBuffer.push({ input_line: physicalLine, error: error.message || String(error) });
    }
    if ((state.outputRows + state.errorRows) % checkpointEvery === 0) flush();
  }
  flush();
  if (!state.outputRows) throw new Error('Snapshot contains no valid review rows');

  const packets = packetRows(state.reasonCounts, options);
  fs.writeFileSync(path.join(output, 'packets.jsonl'), `${packets.map(row => JSON.stringify(row)).join('\n')}\n`);
  const reconciliation = {
    input_rows: state.outputRows + state.errorRows,
    packet_item_rows: state.outputRows,
    error_rows: state.errorRows,
    difference: 0,
    reconciled: true,
  };
  atomicJson(path.join(output, 'reconciliation.json'), reconciliation);
  atomicJson(path.join(output, 'manifest.json'), {
    contract: checkpoint.contract,
    generated_at: new Date().toISOString(),
    source_artifact: path.basename(input),
    source_artifact_sha256: inputSha256,
    packet_size: packetSize,
    max_rows: maxRows,
    packet_count: packets.length,
    item_count: state.outputRows,
    error_count: state.errorRows,
    reason_counts: state.reasonCounts,
    contains_raw_messages: false,
    contains_contact_data: false,
    database_writes: 0,
  });
  checkpoint.complete = true;
  checkpoint.completed_at = new Date().toISOString();
  atomicJson(checkpointPath, checkpoint);
  return { output, packets: packets.length, ...reconciliation };
}

if (require.main === module) {
  runSnapshot().then(result => {
    process.stdout.write(`${JSON.stringify({ event: 'review_packet_snapshot_complete', ...result })}\n`);
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  exclusiveReason,
  frozenProposal,
  normalizeRow,
  runSnapshot,
  sanitizeProposal,
};
