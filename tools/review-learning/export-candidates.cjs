'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  CORRECTION_FIELDS,
  proposalSha256,
  sha256,
  stableValue,
} = require('../../api/_lib/review-packets.cjs');
const { exclusiveReason } = require('../review-packets/snapshot-local.cjs');

const DEFAULT_OUTPUT = path.resolve('audit-output/review-learning-candidates');
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,300}$/;
const SAFE_TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,79}$/;
const NUMERIC_FIELDS = new Set(['year', 'price_raw', 'price_usd']);
const EXPECTED_TABLES = {
  decisionsTable: 'normalization_review_packet_decisions',
  itemsTable: 'normalization_review_packet_items',
  packetsTable: 'normalization_review_packets',
  sourceTable: 'watch_records',
};

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function integer(value, fallback, minimum, maximum, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function tableName(value, label) {
  const table = required(value, label);
  if (!SAFE_TABLE.test(table)) throw new Error(`${label} must be an unqualified lowercase table name`);
  return table;
}

function expectedTable(value, label, expected) {
  const table = tableName(value, label);
  if (table !== expected) throw new Error(`${label} must be explicitly set to ${expected}`);
  return table;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function appendJsonl(filePath, rows) {
  if (rows.length) fs.appendFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function inFilter(ids) {
  return `in.(${ids.map(id => JSON.stringify(id)).join(',')})`;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function configFrom(input = {}, env = process.env) {
  const baseUrl = required(input.baseUrl ?? env.REVIEW_LEARNING_SUPABASE_URL, 'REVIEW_LEARNING_SUPABASE_URL')
    .replace(/\/$/, '');
  const parsedUrl = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)
    || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash
    || parsedUrl.pathname !== '/') {
    throw new Error('REVIEW_LEARNING_SUPABASE_URL must be an HTTP(S) origin');
  }
  return {
    baseUrl: parsedUrl.origin,
    key: required(input.key ?? env.REVIEW_LEARNING_SUPABASE_SERVICE_ROLE_KEY,
      'REVIEW_LEARNING_SUPABASE_SERVICE_ROLE_KEY'),
    decisionsTable: expectedTable(input.decisionsTable ?? env.REVIEW_LEARNING_DECISIONS_TABLE,
      'REVIEW_LEARNING_DECISIONS_TABLE', EXPECTED_TABLES.decisionsTable),
    itemsTable: expectedTable(input.itemsTable ?? env.REVIEW_LEARNING_ITEMS_TABLE,
      'REVIEW_LEARNING_ITEMS_TABLE', EXPECTED_TABLES.itemsTable),
    packetsTable: expectedTable(input.packetsTable ?? env.REVIEW_LEARNING_PACKETS_TABLE,
      'REVIEW_LEARNING_PACKETS_TABLE', EXPECTED_TABLES.packetsTable),
    sourceTable: expectedTable(input.sourceTable ?? env.REVIEW_LEARNING_SOURCE_TABLE,
      'REVIEW_LEARNING_SOURCE_TABLE', EXPECTED_TABLES.sourceTable),
    output: path.resolve(input.output ?? env.REVIEW_LEARNING_OUTPUT ?? DEFAULT_OUTPUT),
    maxDecisions: integer(input.maxDecisions ?? env.REVIEW_LEARNING_MAX_DECISIONS,
      100_000, 1, 100_000, 'maxDecisions'),
    decisionBatch: integer(input.decisionBatch ?? env.REVIEW_LEARNING_DECISION_BATCH,
      250, 1, 1000, 'decisionBatch'),
    idBatch: integer(input.idBatch ?? env.REVIEW_LEARNING_ID_BATCH,
      100, 1, 200, 'idBatch'),
    minimumSupport: integer(input.minimumSupport ?? env.REVIEW_LEARNING_MINIMUM_SUPPORT,
      3, 1, 100_000, 'minimumSupport'),
  };
}

async function getRows(config, table, params, fetchImpl) {
  const query = new URLSearchParams(params);
  const response = await fetchImpl(`${config.baseUrl}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase GET ${table} failed with HTTP ${response.status}`);
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows)) throw new Error(`Supabase GET ${table} did not return an array`);
  return rows;
}

async function getExact(config, table, select, ids, fetchImpl) {
  const rows = [];
  for (const batch of chunks([...new Set(ids)], config.idBatch)) {
    if (!batch.length) continue;
    const requested = new Set(batch);
    const fetched = await getRows(config, table, {
      select,
      id: inFilter(batch),
      limit: String(batch.length),
    }, fetchImpl);
    const returned = new Set();
    for (const row of fetched) {
      const id = String(row?.id || '');
      if (!requested.has(id)) throw new Error(`${table} returned an unrequested lineage id`);
      if (returned.has(id)) throw new Error(`${table} returned a duplicate lineage id`);
      returned.add(id);
      rows.push(row);
    }
  }
  return rows;
}

function correctionFields(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([field]) => !CORRECTION_FIELDS.has(field))) return null;
  for (const [field, proposed] of entries) {
    if (proposed === null) continue;
    if (NUMERIC_FIELDS.has(field)) {
      if (typeof proposed !== 'number' || !Number.isFinite(proposed)
        || (field === 'year' && !Number.isInteger(proposed))
        || (field === 'year'
          && (proposed < 1000 || proposed > new Date().getUTCFullYear() + 1))
        || (field !== 'year' && proposed <= 0)) return null;
    } else if (typeof proposed !== 'string' || !proposed.trim() || proposed.length > 200) {
      return null;
    }
  }
  return stableValue(value);
}

function oldProposalValue(proposal, field) {
  const candidates = proposal?.proposed_candidates;
  const containers = [
    Array.isArray(candidates) ? candidates[0] : null,
    proposal?.candidate,
    proposal,
  ];
  for (const container of containers) {
    if (container && typeof container === 'object'
      && Object.prototype.hasOwnProperty.call(container, field)) {
      const value = container[field];
      if (value === null || typeof value === 'string'
        || (typeof value === 'number' && Number.isFinite(value))) {
        return { present: true, value };
      }
      return { invalid: true };
    }
  }
  return { present: false, value: null };
}

function evidenceError(decision, item, packet, source) {
  if (!Number.isSafeInteger(decision.id) || decision.id < 1) return 'INVALID_DECISION_ID';
  if (!SAFE_ID.test(String(decision.packet_item_id || ''))) return 'INVALID_PACKET_ITEM_ID';
  if (decision.decision !== 'CORRECTION_PROPOSED') return 'INVALID_DECISION';
  const fields = correctionFields(decision.correction_fields);
  if (!fields) return 'INVALID_CORRECTION_FIELDS';
  const expectedRaw = String(decision.expected_raw_sha256 || '').toLowerCase();
  const expectedProposal = String(decision.expected_proposal_sha256 || '').toLowerCase();
  const evidenceHashes = Array.isArray(decision.evidence_hashes)
    ? [...new Set(decision.evidence_hashes.map(value => String(value || '').toLowerCase()))]
    : [];
  if (!SHA256.test(expectedRaw) || !SHA256.test(expectedProposal)
    || evidenceHashes.length < 2 || evidenceHashes.length > 10
    || evidenceHashes.some(value => !SHA256.test(value))
    || !evidenceHashes.includes(expectedRaw) || !evidenceHashes.includes(expectedProposal)) {
    return 'INVALID_EVIDENCE_HASHES';
  }
  if (!item) return 'PACKET_ITEM_NOT_FOUND';
  if (!packet) return 'PACKET_NOT_FOUND';
  if (!source) return 'SOURCE_NOT_FOUND';
  if (!SAFE_ID.test(String(item.source_record_id || ''))
    || !SAFE_ID.test(String(item.packet_id || ''))
    || item.status !== 'PENDING'
    || packet.status !== 'READY_FOR_REVIEW') return 'INVALID_PACKET_LINEAGE';
  if (!SAFE_REASON.test(String(packet.reason || ''))) return 'INVALID_PACKET_REASON';
  if (!item.normalization_version
    || item.normalization_version !== packet.normalization_version) return 'NORMALIZATION_VERSION_MISMATCH';
  const proposal = item.frozen_proposal;
  if (!proposal || Array.isArray(proposal) || typeof proposal !== 'object'
    || !Number.isSafeInteger(proposal.candidate_count)
    || proposal.candidate_count < 0
    || !Array.isArray(proposal.proposed_candidates)
    || !Array.isArray(proposal.change_flags)
    || proposal.candidate_count !== proposal.proposed_candidates.length) {
    return 'INVALID_FROZEN_PROPOSAL';
  }
  if (exclusiveReason({ change_flags: proposal.change_flags }) !== packet.reason) {
    return 'PACKET_REASON_MISMATCH';
  }
  if ((packet.reason === 'NO_CANDIDATE' && proposal.candidate_count !== 0)
    || (packet.reason === 'BUNDLE_SPLIT_REQUIRED')
    || (!['NO_CANDIDATE', 'BUNDLE_SPLIT_REQUIRED'].includes(packet.reason)
      && proposal.candidate_count !== 1)) {
    return 'UNSUPPORTED_CANDIDATE_STRUCTURE';
  }
  if (String(item.raw_message_sha256 || '').toLowerCase() !== expectedRaw
    || String(item.proposal_sha256 || '').toLowerCase() !== expectedProposal) return 'DECISION_HASH_MISMATCH';
  if (proposalSha256(item.frozen_proposal) !== expectedProposal) return 'STALE_PROPOSAL_EVIDENCE';
  if (typeof source.raw_message !== 'string' || !source.raw_message.length) {
    return 'MISSING_RAW_SOURCE_EVIDENCE';
  }
  if (sha256(source.raw_message) !== expectedRaw) return 'STALE_SOURCE_EVIDENCE';
  if (Object.keys(fields).some(field => oldProposalValue(item.frozen_proposal, field).invalid)) {
    return 'INVALID_OLD_PROPOSAL_VALUE';
  }
  return null;
}

function processDecision(decision, item, packet, source) {
  const error = evidenceError(decision, item, packet, source);
  if (error) {
    return {
      error: {
        decision_id: Number.isSafeInteger(decision.id) ? decision.id : null,
        packet_item_id: SAFE_ID.test(String(decision.packet_item_id || ''))
          ? decision.packet_item_id : null,
        error,
      },
    };
  }
  const correction = correctionFields(decision.correction_fields);
  const fixture = {
    packet_item_id: item.id,
    source_record_id: item.source_record_id,
    reason: packet.reason,
    normalization_version: item.normalization_version,
    raw_message_sha256: item.raw_message_sha256,
    proposal_sha256: item.proposal_sha256,
    correction_fields: correction,
  };
  const observations = Object.entries(correction).map(([field, proposed]) => {
    const old = oldProposalValue(item.frozen_proposal, field);
    return {
      reason: packet.reason,
      corrected_field: field,
      old_value_present: old.present,
      old_deterministic_proposal_value: old.value,
      reviewer_proposed_value: proposed,
    };
  });
  return { fixture, observations };
}

async function groupedCandidates(observationsPath, minimumSupport) {
  const groups = new Map();
  const readline = require('node:readline');
  const lines = readline.createInterface({
    input: fs.createReadStream(observationsPath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line);
    const key = JSON.stringify([
      row.reason,
      row.corrected_field,
      row.old_value_present,
      stableValue(row.old_deterministic_proposal_value),
      stableValue(row.reviewer_proposed_value),
    ]);
    const current = groups.get(key);
    if (current) current.support_count += 1;
    else groups.set(key, { ...row, support_count: 1 });
  }
  // ponytail: bounded in-memory grouping is capped by 100k decisions; use an external sort only if that cap grows.
  return [...groups.values()].map(row => ({
    ...row,
    support_reporting_threshold: minimumSupport,
    meets_support_reporting_threshold: row.support_count >= minimumSupport,
    status: 'CANDIDATE_FOR_ENGINEER_REVIEW',
  })).sort((left, right) =>
    right.support_count - left.support_count
    || left.reason.localeCompare(right.reason)
    || left.corrected_field.localeCompare(right.corrected_field)
    || JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function writeCandidates(output, candidates, metadata) {
  atomicJson(path.join(output, 'rule-candidates.json'), {
    contract: 'normalization-rule-candidates-v1',
    generated_at: new Date().toISOString(),
    rules_changed: 0,
    minimum_support_is_reporting_only: true,
    ...metadata,
    candidates,
  });
  const columns = [
    'reason',
    'corrected_field',
    'old_value_present',
    'old_deterministic_proposal_value',
    'reviewer_proposed_value',
    'support_count',
    'support_reporting_threshold',
    'meets_support_reporting_threshold',
    'status',
  ];
  const rows = candidates.map(candidate => columns.map(column => {
    const value = candidate[column];
    return csvValue(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
  }).join(','));
  fs.writeFileSync(path.join(output, 'rule-candidates.csv'), `${columns.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`);
}

async function runExport(input = {}) {
  const config = configFrom(input);
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  fs.mkdirSync(config.output, { recursive: true });
  const fixturePath = path.join(config.output, 'fixture-candidates.jsonl');
  const observationsPath = path.join(config.output, 'rule-observations.jsonl');
  const errorsPath = path.join(config.output, 'errors.jsonl');
  const checkpointPath = path.join(config.output, 'checkpoint.json');
  const fingerprint = sha256(JSON.stringify({
    target: new URL(config.baseUrl).origin,
    decisionsTable: config.decisionsTable,
    itemsTable: config.itemsTable,
    packetsTable: config.packetsTable,
    sourceTable: config.sourceTable,
    maxDecisions: config.maxDecisions,
    decisionBatch: config.decisionBatch,
    idBatch: config.idBatch,
    minimumSupport: config.minimumSupport,
  }));
  let checkpoint = {
    contract: 'normalization-review-learning-export-v1',
    config_sha256: fingerprint,
    last_decision_id: 0,
    input_decisions: 0,
    fixture_rows: 0,
    error_rows: 0,
    corrected_field_observations: 0,
    fixture_bytes: 0,
    observation_bytes: 0,
    error_bytes: 0,
    complete: false,
  };
  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (checkpoint.complete) throw new Error('Export is already complete');
    if (checkpoint.config_sha256 !== fingerprint) throw new Error('Checkpoint configuration does not match');
    for (const [filePath, bytes] of [
      [fixturePath, checkpoint.fixture_bytes],
      [observationsPath, checkpoint.observation_bytes],
      [errorsPath, checkpoint.error_bytes],
    ]) {
      if (!fs.existsSync(filePath)) throw new Error('Checkpoint output is missing');
      fs.truncateSync(filePath, bytes);
    }
  } else {
    for (const filePath of [fixturePath, observationsPath, errorsPath]) {
      if (fs.existsSync(filePath)) throw new Error('Output exists without a checkpoint; choose a new output directory');
      fs.writeFileSync(filePath, '');
    }
    atomicJson(checkpointPath, checkpoint);
  }

  let exhausted = false;
  while (checkpoint.input_decisions < config.maxDecisions) {
    const remaining = config.maxDecisions - checkpoint.input_decisions;
    const decisions = await getRows(config, config.decisionsTable, {
      select: [
        'id', 'packet_item_id', 'decision', 'correction_fields',
        'expected_raw_sha256', 'expected_proposal_sha256', 'evidence_hashes',
      ].join(','),
      id: `gt.${checkpoint.last_decision_id}`,
      order: 'id.asc',
      limit: String(Math.min(config.decisionBatch, remaining)),
    }, fetchImpl);
    if (!decisions.length) {
      exhausted = true;
      break;
    }
    let previousId = checkpoint.last_decision_id;
    for (const decision of decisions) {
      if (!Number.isSafeInteger(decision.id) || decision.id <= previousId) {
        throw new Error('Decision keyset is not strictly increasing safe integers');
      }
      previousId = decision.id;
    }

    const itemIds = decisions.map(row => row.packet_item_id).filter(id => SAFE_ID.test(String(id || '')));
    const items = await getExact(config, config.itemsTable,
      'id,packet_id,source_record_id,normalization_version,frozen_proposal,proposal_sha256,raw_message_sha256,status',
      itemIds, fetchImpl);
    const itemMap = new Map(items.map(row => [row.id, row]));
    const packetIds = items.map(row => row.packet_id).filter(id => SAFE_ID.test(String(id || '')));
    const sourceIds = items.map(row => row.source_record_id).filter(id => SAFE_ID.test(String(id || '')));
    const [packets, sources] = await Promise.all([
      getExact(config, config.packetsTable, 'id,reason,normalization_version,status', packetIds, fetchImpl),
      getExact(config, config.sourceTable, 'id,raw_message', sourceIds, fetchImpl),
    ]);
    const packetMap = new Map(packets.map(row => [row.id, row]));
    const sourceMap = new Map(sources.map(row => [row.id, row]));
    const fixtures = [];
    const observations = [];
    const errors = [];
    for (const decision of decisions) {
      const item = itemMap.get(decision.packet_item_id);
      const result = processDecision(
        decision,
        item,
        item ? packetMap.get(item.packet_id) : null,
        item ? sourceMap.get(item.source_record_id) : null,
      );
      if (result.error) errors.push(result.error);
      else {
        fixtures.push(result.fixture);
        observations.push(...result.observations);
      }
    }
    appendJsonl(fixturePath, fixtures);
    appendJsonl(observationsPath, observations);
    appendJsonl(errorsPath, errors);
    checkpoint = {
      ...checkpoint,
      last_decision_id: decisions.at(-1).id,
      input_decisions: checkpoint.input_decisions + decisions.length,
      fixture_rows: checkpoint.fixture_rows + fixtures.length,
      error_rows: checkpoint.error_rows + errors.length,
      corrected_field_observations: checkpoint.corrected_field_observations + observations.length,
      fixture_bytes: fs.statSync(fixturePath).size,
      observation_bytes: fs.statSync(observationsPath).size,
      error_bytes: fs.statSync(errorsPath).size,
      updated_at: new Date().toISOString(),
    };
    atomicJson(checkpointPath, checkpoint);
  }

  let selectionTruncated = false;
  if (!exhausted && checkpoint.input_decisions === config.maxDecisions) {
    selectionTruncated = (await getRows(config, config.decisionsTable, {
      select: 'id',
      id: `gt.${checkpoint.last_decision_id}`,
      order: 'id.asc',
      limit: '1',
    }, fetchImpl)).length > 0;
  }
  const difference = checkpoint.input_decisions - checkpoint.fixture_rows - checkpoint.error_rows;
  if (difference !== 0) throw new Error('Input decisions do not reconcile to fixtures plus errors');
  const candidates = await groupedCandidates(observationsPath, config.minimumSupport);
  writeCandidates(config.output, candidates, {
    selected_decisions: checkpoint.input_decisions,
    valid_fixture_rows: checkpoint.fixture_rows,
    error_rows: checkpoint.error_rows,
    selection_truncated: selectionTruncated,
  });
  const reconciliation = {
    input_decisions: checkpoint.input_decisions,
    fixture_rows: checkpoint.fixture_rows,
    error_rows: checkpoint.error_rows,
    difference,
    reconciled: true,
  };
  atomicJson(path.join(config.output, 'reconciliation.json'), reconciliation);
  atomicJson(path.join(config.output, 'manifest.json'), {
    contract: checkpoint.contract,
    generated_at: new Date().toISOString(),
    max_decisions: config.maxDecisions,
    decision_batch: config.decisionBatch,
    exact_id_batch: config.idBatch,
    minimum_support_is_reporting_only: true,
    selection_truncated: selectionTruncated,
    contains_raw_messages: false,
    contains_contact_data: false,
    contains_reviewer_identity: false,
    contains_rationale: false,
    llm_calls: 0,
    database_get_requests_only: true,
    database_writes: 0,
    normalization_rules_changed: 0,
    ...reconciliation,
    corrected_field_observations: checkpoint.corrected_field_observations,
    rule_candidate_groups: candidates.length,
  });
  checkpoint.complete = true;
  checkpoint.selection_truncated = selectionTruncated;
  checkpoint.completed_at = new Date().toISOString();
  atomicJson(checkpointPath, checkpoint);
  return { output: config.output, candidates: candidates.length, ...reconciliation, selectionTruncated };
}

if (require.main === module) {
  runExport().then(result => {
    process.stdout.write(`${JSON.stringify({ event: 'review_learning_export_complete', ...result })}\n`);
    if (result.error_rows) process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  configFrom,
  evidenceError,
  oldProposalValue,
  processDecision,
  runExport,
};
