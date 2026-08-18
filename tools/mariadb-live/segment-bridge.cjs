'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicJson, boundedInteger, readJsonLines, stableJson } = require('./lib.cjs');
const { assertSafeTransport, stagingRecord } = require('./import-normalized-staging.cjs');
const { acquireOutputLock } = require('./collect.cjs');

const BRIDGE_CONTRACT = 'wf-mariadb-live-segment-bridge-v1';
const SEGMENT = /^(\d{9})-([a-f0-9]{12})\.jsonl\.gz$/;

function checkpointIntegrity(checkpoint) {
  const copy = { ...checkpoint };
  delete copy.checkpoint_integrity_sha256;
  return crypto.createHash('sha256').update(stableJson(copy)).digest('hex');
}

function persistCheckpoint(file, checkpoint) {
  checkpoint.checkpoint_integrity_sha256 = checkpointIntegrity(checkpoint);
  atomicJson(file, checkpoint);
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function segmentFiles(root) {
  const rawDir = path.join(root, 'raw');
  const proposalDir = path.join(root, 'proposals');
  if (!fs.existsSync(rawDir) || !fs.existsSync(proposalDir)) return [];
  return fs.readdirSync(rawDir).filter(name => SEGMENT.test(name)).sort().map(name => {
    const proposal = path.join(proposalDir, name);
    if (!fs.existsSync(proposal)) throw new Error(`Segment ${name} has no exact proposal replica`);
    const [, sequence, cursorHash] = name.match(SEGMENT);
    return { name, sequence: Number(sequence), cursorHash, raw: path.join(rawDir, name), proposal };
  });
}

function prepareBridge(output, sourceRoot, replicaId = 'primary') {
  if (replicaId !== 'primary') throw new Error('Exactly one bridge replica is permitted');
  fs.mkdirSync(output, { recursive: true });
  const checkpointPath = path.join(output, 'checkpoint.json');
  const deadLetterPath = path.join(output, 'dead-letter.jsonl');
  let checkpoint = {
    contract: BRIDGE_CONTRACT,
    source_root: path.resolve(sourceRoot),
    replica_id: replicaId,
    last_sequence: 0,
    last_created_on: '1970-01-01 00:00:00',
    last_source_id: '',
    raw_rows_accounted: 0,
    staging_rows_accounted: 0,
    publication_writes: 0,
    segment_chain_sha256: '0'.repeat(64),
  };
  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (checkpoint.contract !== BRIDGE_CONTRACT
      || checkpoint.source_root !== path.resolve(sourceRoot)
      || checkpoint.replica_id !== replicaId
      || Number(checkpoint.publication_writes) !== 0
      || checkpoint.checkpoint_integrity_sha256 !== checkpointIntegrity(checkpoint)) {
      throw new Error('Segment bridge checkpoint contract mismatch');
    }
  } else persistCheckpoint(checkpointPath, checkpoint);
  return { checkpoint, checkpointPath, deadLetterPath };
}

function compareCursor(previous, source) {
  const createdOn = String(source.source_created_on || '');
  const sourceId = String(source.source_id || '');
  if (!createdOn || !sourceId || createdOn < previous.last_created_on
    || (createdOn === previous.last_created_on && sourceId <= previous.last_source_id)) {
    throw new Error(`Non-increasing source cursor at ${source.source_record_id || 'unknown'}`);
  }
  return { last_created_on: createdOn, last_source_id: sourceId };
}

function safeStaging(source, proposal) {
  if (proposal.source_record_id !== source.source_record_id || proposal.source_hash !== source.raw_sha256) {
    throw new Error('Proposal lineage does not match immutable raw source');
  }
  const record = stagingRecord(source, proposal);
  if (!['SINGLE', 'DEFERRED'].includes(record.materialization)) throw new Error('Unexpected materialization');
  if (record.candidate && !['WTS', 'WTB'].includes(record.candidate.listing_type)) {
    throw new Error('WTS and WTB must remain separate');
  }
  if (record.materialization !== 'SINGLE') {
    record.media = {
      source_media_key: null,
      source_media_url_candidate: null,
      exact_source_lineage: false,
      public_image_eligible: false,
      review_reason: 'PARENT_MEDIA_WITHHELD',
    };
  } else if (record.media.source_media_key
    && record.media.source_media_key !== source.raw_data?.front_image) {
    throw new Error('Single candidate media key is not the exact source key');
  }
  record.public_image_eligible = false;
  record.contact_publication_approved = false;
  return assertSafeTransport(record);
}

async function loadSegment(segment, previousCursor, maxRows) {
  const rawIterator = readJsonLines(segment.raw)[Symbol.asyncIterator]();
  const proposalIterator = readJsonLines(segment.proposal)[Symbol.asyncIterator]();
  const raw = [];
  const staging = [];
  let cursor = previousCursor;
  for (;;) {
    const [rawLine, proposalLine] = await Promise.all([rawIterator.next(), proposalIterator.next()]);
    if (rawLine.done !== proposalLine.done) throw new Error('Raw and proposal segment row counts differ');
    if (rawLine.done) break;
    if (!rawLine.value.trim() || !proposalLine.value.trim()) throw new Error('Blank segment rows are not permitted');
    if (raw.length >= maxRows) throw new Error(`Segment exceeds bounded row limit ${maxRows}`);
    const source = JSON.parse(rawLine.value);
    const proposal = JSON.parse(proposalLine.value);
    cursor = compareCursor(cursor, source);
    raw.push(source);
    staging.push(safeStaging(source, proposal));
  }
  if (!raw.length) throw new Error('Empty segments are not ingestible');
  const cursorHash = crypto.createHash('sha256')
    .update(`${cursor.last_created_on}\n${cursor.last_source_id}`)
    .digest('hex').slice(0, 12);
  if (cursorHash !== segment.cursorHash) throw new Error('Segment filename cursor hash mismatch');
  return { raw, staging, cursor };
}

function deadLetter(file, segment, error) {
  const record = {
    contract: BRIDGE_CONTRACT,
    segment_name: segment.name,
    segment_sequence: segment.sequence,
    error_code: 'SEGMENT_VALIDATION_OR_INGEST_FAILED',
    error_code_detail: /^[A-Z0-9_]{1,64}$/.test(String(error.code || '')) ? String(error.code) : null,
    error_name: error.name || 'Error',
    error_message: 'Secure operator review required; source or server error text is not copied to the dead-letter ledger',
    occurred_at: new Date().toISOString(),
    raw_text_logged: false,
    pii_logged: false,
    checkpoint_advanced: false,
  };
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

async function runBridgeLocked(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const output = path.resolve(options.output);
  const maxRows = boundedInteger(options.maxRows, 1000, 1, 5000, 'SEGMENT_BRIDGE_MAX_ROWS');
  const maxSegments = boundedInteger(options.maxSegments, 1, 1, 100, 'SEGMENT_BRIDGE_MAX_SEGMENTS');
  const maxPendingSegments = boundedInteger(options.maxPendingSegments, 100, 1, 10000, 'SEGMENT_BRIDGE_MAX_PENDING_SEGMENTS');
  const minFreeBytes = boundedInteger(options.minFreeBytes, 1024 * 1024 * 1024, 0, Number.MAX_SAFE_INTEGER, 'SEGMENT_BRIDGE_MIN_FREE_BYTES');
  const ingestSegment = options.ingestSegment;
  if (typeof ingestSegment !== 'function') throw new Error('No idempotent QNSA segment ingestor supplied');
  const prepared = prepareBridge(output, sourceRoot, options.replicaId || 'primary');
  const state = { ...prepared.checkpoint };
  const pending = segmentFiles(sourceRoot).filter(segment => segment.sequence > state.last_sequence);
  if (pending.length && pending[0].sequence !== state.last_sequence + 1) throw new Error('Segment sequence gap detected');
  if (pending.length > maxPendingSegments) throw new Error(`Segment backlog ${pending.length} exceeds backpressure limit ${maxPendingSegments}`);
  const disk = fs.statfsSync(output);
  if (Number(disk.bavail) * Number(disk.bsize) < minFreeBytes) throw new Error('Insufficient free disk for safe segment processing');
  let processed = 0;
  for (const segment of pending.slice(0, maxSegments)) {
    try {
      if (segment.sequence !== state.last_sequence + 1) throw new Error('Segment sequence gap detected');
      const loaded = await loadSegment(segment, state, maxRows);
      const token = crypto.createHash('sha256').update(stableJson({
        contract: BRIDGE_CONTRACT,
        sequence: segment.sequence,
        raw_sha256: sha256File(segment.raw),
        proposal_sha256: sha256File(segment.proposal),
      })).digest('hex');
      const nextChain = crypto.createHash('sha256')
        .update(`${state.segment_chain_sha256}\n${token}`)
        .digest('hex');
      const result = await ingestSegment({
        contract: BRIDGE_CONTRACT,
        batch_token: token,
        sequence: segment.sequence,
        expected_previous_cursor: { last_created_on: state.last_created_on, last_source_id: state.last_source_id },
        next_cursor: loaded.cursor,
        expected_previous_segment_chain_sha256: state.segment_chain_sha256,
        next_segment_chain_sha256: nextChain,
        raw_records: loaded.raw,
        staging_records: loaded.staging,
        publication_authorized: false,
      });
      if (Number(result?.raw_accounted) !== loaded.raw.length
        || Number(result?.staging_accounted) !== loaded.staging.length
        || Number(result?.error_rows || 0) !== 0
        || Number(result?.publication_writes || 0) !== 0
        || result?.idempotent !== true
        || result?.segment_chain_sha256 !== nextChain) throw new Error('QNSA segment result did not reconcile idempotently');
      state.last_sequence = segment.sequence;
      state.last_created_on = loaded.cursor.last_created_on;
      state.last_source_id = loaded.cursor.last_source_id;
      state.raw_rows_accounted += loaded.raw.length;
      state.staging_rows_accounted += loaded.staging.length;
      state.segment_chain_sha256 = nextChain;
      state.updated_at = new Date().toISOString();
      persistCheckpoint(prepared.checkpointPath, state);
      processed += 1;
    } catch (error) {
      deadLetter(prepared.deadLetterPath, segment, error);
      throw error;
    }
  }
  return { ...state, processed_segments: processed, pending_segments: Math.max(0, pending.length - processed) };
}

async function runBridge(options = {}) {
  const output = path.resolve(options.output);
  const release = acquireOutputLock(output);
  try {
    return await runBridgeLocked(options);
  } finally {
    release();
  }
}

module.exports = {
  BRIDGE_CONTRACT,
  checkpointIntegrity,
  compareCursor,
  loadSegment,
  prepareBridge,
  runBridge,
  runBridgeLocked,
  safeStaging,
  segmentFiles,
};
