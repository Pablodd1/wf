'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { proposalSha256, sha256 } = require('../../api/_lib/review-packets.cjs');
const { exclusiveReason } = require('./snapshot-local.cjs');

const APPROVAL = 'IMPORT_PRIVATE_NORMALIZATION_REVIEW_PACKETS';
const HARD_ITEM_CAP = 100_000;
const HEADER_KEYS = [
  'id', 'item_count', 'normalization_version', 'reason',
  'source_artifact_sha256', 'status',
];
const ITEM_KEYS = [
  'frozen_proposal', 'id', 'normalization_version', 'ordinal', 'packet_id',
  'proposal_sha256', 'raw_message_sha256', 'source_record_id', 'status',
];
const SHA256 = /^[a-f0-9]{64}$/;
const PRIVATE_KEY = /^(?:raw_message|raw_line)$|(?:^|_)(?:seller|phone|contact|email|observed_name|source_identity)(?:$|_)/i;

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
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

function exactKeys(value, expected) {
  return value && !Array.isArray(value) && typeof value === 'object'
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function hasPrivateKey(value) {
  if (Array.isArray(value)) return value.some(hasPrivateKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => PRIVATE_KEY.test(key) || hasPrivateKey(child));
}

function normalizeUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} must be an explicit http(s) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an explicit http(s) URL without credentials, query, or fragment`);
  }
  if (url.pathname !== '/') throw new Error(`${label} must be an origin without a path`);
  return url.toString().replace(/\/$/, '');
}

function resolveConfig(env = process.env) {
  if (env.REVIEW_PACKET_IMPORT_APPROVAL !== APPROVAL) {
    throw new Error(`REVIEW_PACKET_IMPORT_APPROVAL must equal ${APPROVAL}`);
  }
  const target = normalizeUrl(env.REVIEW_PACKET_IMPORT_URL, 'REVIEW_PACKET_IMPORT_URL');
  const allowed = String(env.REVIEW_PACKET_IMPORT_ALLOWED_TARGETS || '')
    .split(',').map(value => value.trim()).filter(Boolean)
    .map(value => normalizeUrl(value, 'REVIEW_PACKET_IMPORT_ALLOWED_TARGETS'));
  if (!allowed.length || !allowed.includes(target)) {
    throw new Error('REVIEW_PACKET_IMPORT_URL is not in the explicit REVIEW_PACKET_IMPORT_ALLOWED_TARGETS allowlist');
  }
  const serviceKey = String(env.REVIEW_PACKET_IMPORT_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) throw new Error('REVIEW_PACKET_IMPORT_SERVICE_ROLE_KEY is required');
  const inputDir = path.resolve(String(env.REVIEW_PACKET_IMPORT_DIR || '').trim());
  if (!env.REVIEW_PACKET_IMPORT_DIR) throw new Error('REVIEW_PACKET_IMPORT_DIR is required');
  return {
    target,
    serviceKey,
    inputDir,
    checkpointPath: path.resolve(
      env.REVIEW_PACKET_IMPORT_CHECKPOINT || path.join(inputDir, 'import-checkpoint.json'),
    ),
    reconciliationPath: path.resolve(
      env.REVIEW_PACKET_IMPORT_RECONCILIATION || path.join(inputDir, 'import-reconciliation.json'),
    ),
  };
}

async function readJsonl(filePath) {
  const rows = [];
  const lines = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error(`${path.basename(filePath)}:${lineNumber} is not valid JSON`);
    }
  }
  return rows;
}

function validateHeader(packet) {
  const expectedId = packet && typeof packet === 'object'
    ? `rp_${String(packet.source_artifact_sha256 || '').slice(0, 12)}_${String(packet.reason || '').toLowerCase()}_`
    : '';
  if (!exactKeys(packet, HEADER_KEYS)
    || !/^rp_[a-z0-9_]{1,280}$/.test(packet.id)
    || !packet.id.startsWith(expectedId)
    || !/^[0-9]{4,6}$/.test(packet.id.slice(expectedId.length))
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(packet.reason)
    || typeof packet.normalization_version !== 'string'
    || packet.normalization_version.length < 1
    || packet.normalization_version.length > 120
    || !SHA256.test(packet.source_artifact_sha256)
    || packet.status !== 'READY_FOR_REVIEW'
    || !Number.isSafeInteger(packet.item_count)
    || packet.item_count < 1
    || packet.item_count > 500) {
    throw new Error(`Invalid packet header ${String(packet?.id || '')}`);
  }
}

function validateItem(item, packet) {
  if (!exactKeys(item, ITEM_KEYS)
    || !/^ri_[a-f0-9]{40}$/.test(item.id)
    || item.packet_id !== packet.id
    || !Number.isSafeInteger(item.ordinal)
    || item.ordinal < 1
    || item.ordinal > packet.item_count
    || typeof item.source_record_id !== 'string'
    || item.source_record_id.length < 1
    || item.source_record_id.length > 300
    || item.normalization_version !== packet.normalization_version
    || !item.frozen_proposal
    || Array.isArray(item.frozen_proposal)
    || typeof item.frozen_proposal !== 'object'
    || !SHA256.test(item.proposal_sha256)
    || !SHA256.test(item.raw_message_sha256)
    || item.status !== 'PENDING') {
    throw new Error(`Invalid packet item ${String(item?.id || '')}`);
  }
  const expectedItemId = `ri_${sha256(
    `${packet.id}|${item.ordinal}|${item.source_record_id}|${item.normalization_version}`,
  ).slice(0, 40)}`;
  if (item.id !== expectedItemId) {
    throw new Error(`Packet item id mismatch ${item.id}`);
  }
  if (hasPrivateKey(item.frozen_proposal)) {
    throw new Error(`Private evidence key in packet item ${item.id}`);
  }
  if (!Number.isSafeInteger(item.frozen_proposal.candidate_count)
    || item.frozen_proposal.candidate_count < 0
    || !Array.isArray(item.frozen_proposal.proposed_candidates)
    || !Array.isArray(item.frozen_proposal.change_flags)
    || item.frozen_proposal.candidate_count !== item.frozen_proposal.proposed_candidates.length) {
    throw new Error(`Invalid frozen proposal in packet item ${item.id}`);
  }
  if ((packet.reason === 'NO_CANDIDATE' && item.frozen_proposal.candidate_count !== 0)
    || (packet.reason === 'BUNDLE_SPLIT_REQUIRED' && item.frozen_proposal.candidate_count <= 1)
    || (!['NO_CANDIDATE', 'BUNDLE_SPLIT_REQUIRED'].includes(packet.reason)
      && item.frozen_proposal.candidate_count !== 1)) {
    throw new Error(`Candidate count disagrees with packet reason for item ${item.id}`);
  }
  if (exclusiveReason({ change_flags: item.frozen_proposal.change_flags }) !== packet.reason) {
    throw new Error(`Packet reason mismatch for item ${item.id}`);
  }
  if (proposalSha256(item.frozen_proposal) !== item.proposal_sha256) {
    throw new Error(`Proposal hash mismatch in packet item ${item.id}`);
  }
}

async function loadAndValidate(inputDir) {
  const paths = Object.fromEntries(['manifest.json', 'reconciliation.json', 'packets.jsonl', 'packet-items.jsonl']
    .map(name => [name, path.join(inputDir, name)]));
  for (const [name, filePath] of Object.entries(paths)) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Missing ${name}`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(paths['manifest.json'], 'utf8'));
  const sourceReconciliation = JSON.parse(fs.readFileSync(paths['reconciliation.json'], 'utf8'));
  if (manifest.contract !== 'normalization-review-packet-snapshot-v1'
    || manifest.contains_raw_messages !== false
    || manifest.contains_contact_data !== false
    || !SHA256.test(manifest.source_artifact_sha256)
    || !Number.isSafeInteger(manifest.packet_count)
    || !Number.isSafeInteger(manifest.item_count)
    || !Number.isSafeInteger(manifest.error_count)
    || !Number.isSafeInteger(manifest.max_rows)
    || !Number.isSafeInteger(manifest.packet_size)
    || manifest.packet_count < 1
    || manifest.packet_count > manifest.item_count
    || manifest.item_count < 1
    || manifest.item_count > HARD_ITEM_CAP
    || manifest.error_count < 0
    || manifest.max_rows < manifest.item_count
    || manifest.max_rows > HARD_ITEM_CAP
    || manifest.packet_size < 1
    || manifest.packet_size > 500
    || manifest.database_writes !== 0) {
    throw new Error('Invalid or unsafe snapshot manifest');
  }
  if (sourceReconciliation.reconciled !== true
    || sourceReconciliation.difference !== 0
    || sourceReconciliation.packet_item_rows !== manifest.item_count
    || sourceReconciliation.error_rows !== manifest.error_count
    || sourceReconciliation.input_rows !==
      sourceReconciliation.packet_item_rows + sourceReconciliation.error_rows
    || sourceReconciliation.input_rows > manifest.max_rows) {
    throw new Error('Source snapshot does not reconcile exactly');
  }

  const packets = await readJsonl(paths['packets.jsonl']);
  const items = await readJsonl(paths['packet-items.jsonl']);
  if (packets.length !== manifest.packet_count || items.length !== manifest.item_count) {
    throw new Error('Manifest count does not match packet artifacts');
  }
  const packetById = new Map();
  const itemsByPacket = new Map();
  for (const packet of packets) {
    validateHeader(packet);
    if (packet.item_count > manifest.packet_size) {
      throw new Error(`Packet ${packet.id} exceeds the manifest packet size`);
    }
    if (packet.source_artifact_sha256 !== manifest.source_artifact_sha256) {
      throw new Error(`Source artifact hash mismatch in packet ${packet.id}`);
    }
    if (packetById.has(packet.id)) throw new Error(`Duplicate packet id ${packet.id}`);
    packetById.set(packet.id, packet);
    itemsByPacket.set(packet.id, []);
  }
  const itemIds = new Set();
  const memberships = new Set();
  for (const item of items) {
    const packet = packetById.get(item?.packet_id);
    if (!packet) throw new Error(`Unknown packet for item ${String(item?.id || '')}`);
    validateItem(item, packet);
    const membership = `${item.source_record_id}\u0000${item.normalization_version}`;
    if (itemIds.has(item.id) || memberships.has(membership)) {
      throw new Error(`Duplicate packet membership ${item.id}`);
    }
    itemIds.add(item.id);
    memberships.add(membership);
    itemsByPacket.get(packet.id).push(item);
  }
  for (const packet of packets) {
    const packetItems = itemsByPacket.get(packet.id).sort((left, right) => left.ordinal - right.ordinal);
    if (packetItems.length !== packet.item_count
      || packetItems.some((item, index) => item.ordinal !== index + 1)) {
      throw new Error(`Packet ${packet.id} does not contain its exact contiguous item count`);
    }
  }
  const artifactHashes = Object.fromEntries(
    Object.entries(paths).map(([name, filePath]) => [name, fileSha256(filePath)]),
  );
  return {
    manifest,
    packets: [...packets].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    itemsByPacket,
    artifactHashes,
  };
}

async function importPacket(config, packet, items, fetchImpl) {
  const response = await fetchImpl(`${config.target}/rest/v1/rpc/import_normalization_review_packet`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      authorization: `Bearer ${config.serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_packet: packet, p_items: items }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Packet ${packet.id} import failed with HTTP ${response.status}${body?.code ? ` (${body.code})` : ''}`);
  }
  if (body?.packet_id !== packet.id
    || body?.item_count !== items.length
    || body?.exact_match !== true
    || body?.watch_records_mutated !== false) {
    throw new Error(`Packet ${packet.id} returned an invalid reconciliation response`);
  }
  return body;
}

async function runImporter(options = {}) {
  const config = options.config || resolveConfig(options.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const loaded = await loadAndValidate(config.inputDir);
  let checkpoint = {
    contract: 'normalization-review-packet-import-v1',
    target: config.target,
    artifact_hashes: loaded.artifactHashes,
    packet_count: loaded.packets.length,
    item_count: loaded.manifest.item_count,
    completed_packets: 0,
    imported_items: 0,
    complete: false,
  };
  if (fs.existsSync(config.checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(config.checkpointPath, 'utf8'));
    if (checkpoint.contract !== 'normalization-review-packet-import-v1'
      || checkpoint.target !== config.target
      || JSON.stringify(checkpoint.artifact_hashes) !== JSON.stringify(loaded.artifactHashes)
      || checkpoint.packet_count !== loaded.packets.length
      || checkpoint.item_count !== loaded.manifest.item_count
      || !Number.isSafeInteger(checkpoint.completed_packets)
      || checkpoint.completed_packets < 0
      || checkpoint.completed_packets > loaded.packets.length
      || !Number.isSafeInteger(checkpoint.imported_items)
      || checkpoint.imported_items !== loaded.packets
        .slice(0, checkpoint.completed_packets)
        .reduce((total, packet) => total + packet.item_count, 0)) {
      throw new Error('Import checkpoint does not match target or immutable input artifacts');
    }
  }

  for (let index = checkpoint.completed_packets; index < loaded.packets.length; index += 1) {
    const packet = loaded.packets[index];
    const items = loaded.itemsByPacket.get(packet.id);
    await importPacket(config, packet, items, fetchImpl);
    checkpoint.completed_packets = index + 1;
    checkpoint.imported_items += items.length;
    checkpoint.updated_at = new Date().toISOString();
    atomicJson(config.checkpointPath, checkpoint);
  }
  const reconciled = checkpoint.completed_packets === loaded.packets.length
    && checkpoint.imported_items === loaded.manifest.item_count;
  const result = {
    contract: checkpoint.contract,
    target: config.target,
    input_packets: loaded.packets.length,
    imported_packets: checkpoint.completed_packets,
    input_items: loaded.manifest.item_count,
    imported_items: checkpoint.imported_items,
    difference: loaded.manifest.item_count - checkpoint.imported_items,
    reconciled,
    watch_records_mutated: false,
  };
  if (!reconciled) throw new Error('Import did not reconcile exactly');
  checkpoint.complete = true;
  checkpoint.completed_at = new Date().toISOString();
  atomicJson(config.checkpointPath, checkpoint);
  atomicJson(config.reconciliationPath, result);
  return result;
}

if (require.main === module) {
  runImporter().then(result => {
    process.stdout.write(`${JSON.stringify({ event: 'normalization_review_packet_import_complete', ...result })}\n`);
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  APPROVAL,
  HARD_ITEM_CAP,
  hasPrivateKey,
  loadAndValidate,
  resolveConfig,
  runImporter,
  validateHeader,
  validateItem,
};
