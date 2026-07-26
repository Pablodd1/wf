'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { proposalSha256, sha256 } = require('../api/_lib/review-packets.cjs');
const {
  configFrom,
  runExport,
} = require('../tools/review-learning/export-candidates.cjs');

function dataset(count = 3) {
  const decisions = [];
  const items = [];
  const packets = [];
  const watchRecords = [];
  for (let index = 1; index <= count; index += 1) {
    const raw = `immutable evidence ${index}`;
    const proposal = {
      candidate_count: 1,
      change_flags: ['CURRENCY_AMBIGUOUS'],
      proposed_candidates: [{ reference: 'OLD-REF', currency: null }],
    };
    const rawHash = sha256(raw);
    const proposalHash = proposalSha256(proposal);
    decisions.push({
      id: index,
      packet_item_id: `item-${index}`,
      decision: 'CORRECTION_PROPOSED',
      correction_fields: { reference: 'NEW-REF', currency: 'USD' },
      expected_raw_sha256: rawHash,
      expected_proposal_sha256: proposalHash,
      evidence_hashes: [rawHash, proposalHash],
      rationale: `private rationale ${index}`,
      reviewer_email: `reviewer${index}@example.com`,
    });
    items.push({
      id: `item-${index}`,
      packet_id: `packet-${index}`,
      source_record_id: `source-${index}`,
      normalization_version: 'v4.2-line-condition',
      frozen_proposal: proposal,
      proposal_sha256: proposalHash,
      raw_message_sha256: rawHash,
      status: 'PENDING',
    });
    packets.push({
      id: `packet-${index}`,
      reason: 'CURRENCY_AMBIGUOUS',
      normalization_version: 'v4.2-line-condition',
      status: 'READY_FOR_REVIEW',
    });
    watchRecords.push({ id: `source-${index}`, raw_message: raw });
  }
  return {
    decisions,
    items,
    packets,
    watchRecords,
  };
}

function exactIds(filter) {
  assert.match(filter, /^in\.\(/);
  return JSON.parse(`[${filter.slice(4, -1)}]`);
}

function mockSupabase(data, options = {}) {
  const calls = [];
  let failed = false;
  const tables = {
    normalization_review_packet_decisions: data.decisions,
    normalization_review_packet_items: data.items,
    normalization_review_packets: data.packets,
    watch_records: data.watchRecords,
  };
  async function fetchImpl(input, init) {
    const url = new URL(input);
    const table = url.pathname.split('/').at(-1);
    calls.push({ table, method: init.method, params: url.searchParams });
    if (options.failAfterDecisionId
      && table === 'normalization_review_packet_decisions'
      && url.searchParams.get('id') === `gt.${options.failAfterDecisionId}`
      && !failed) {
      failed = true;
      throw new Error('mock interrupted');
    }
    let rows = tables[table] || [];
    const idFilter = url.searchParams.get('id');
    if (idFilter?.startsWith('gt.')) {
      const after = Number(idFilter.slice(3));
      rows = rows.filter(row => row.id > after).sort((a, b) => a.id - b.id);
    } else if (idFilter?.startsWith('in.')) {
      const ids = new Set(exactIds(idFilter));
      rows = rows.filter(row => ids.has(row.id));
    }
    rows = rows.slice(0, Number(url.searchParams.get('limit') || rows.length));
    const fields = String(url.searchParams.get('select') || '').split(',');
    rows = rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rows),
    };
  }
  return { calls, fetchImpl };
}

function options(output, fetchImpl, overrides = {}) {
  return {
    baseUrl: 'https://review-only.example',
    key: 'test-only-key',
    decisionsTable: 'normalization_review_packet_decisions',
    itemsTable: 'normalization_review_packet_items',
    packetsTable: 'normalization_review_packets',
    sourceTable: 'watch_records',
    output,
    fetchImpl,
    maxDecisions: 100,
    decisionBatch: 100,
    idBatch: 2,
    minimumSupport: 2,
    ...overrides,
  };
}

test('GET-only exporter groups validated corrections and excludes private review evidence', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-learning-'));
  const data = dataset();
  data.watchRecords[2].raw_message = 'changed evidence';
  const mock = mockSupabase(data);
  try {
    const result = await runExport(options(temporary, mock.fetchImpl));
    assert.deepEqual({
      input: result.input_decisions,
      fixtures: result.fixture_rows,
      errors: result.error_rows,
      difference: result.difference,
    }, { input: 3, fixtures: 2, errors: 1, difference: 0 });
    assert.equal(result.selectionTruncated, false);
    assert.ok(mock.calls.every(call => call.method === 'GET'));
    assert.ok(mock.calls.filter(call => call.table !== 'normalization_review_packet_decisions')
      .every(call => call.params.get('id').startsWith('in.(')));
    const sourceCalls = mock.calls.filter(call => call.table === 'watch_records');
    assert.ok(sourceCalls.every(call => call.params.get('select') === 'id,raw_message'));
    const decisionSelect = mock.calls
      .find(call => call.table === 'normalization_review_packet_decisions').params.get('select');
    assert.doesNotMatch(decisionSelect, /rationale|reviewer|email|raw_message/);

    const fixtures = fs.readFileSync(path.join(temporary, 'fixture-candidates.jsonl'), 'utf8')
      .trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(fixtures.length, 2);
    assert.deepEqual(Object.keys(fixtures[0]), [
      'packet_item_id',
      'source_record_id',
      'reason',
      'normalization_version',
      'raw_message_sha256',
      'proposal_sha256',
      'correction_fields',
    ]);
    const errors = fs.readFileSync(path.join(temporary, 'errors.jsonl'), 'utf8')
      .trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(errors, [{
      decision_id: 3,
      packet_item_id: 'item-3',
      error: 'STALE_SOURCE_EVIDENCE',
    }]);

    const ruleReport = JSON.parse(fs.readFileSync(path.join(temporary, 'rule-candidates.json'), 'utf8'));
    const reference = ruleReport.candidates.find(candidate => candidate.corrected_field === 'reference');
    assert.equal(reference.support_count, 2);
    assert.equal(reference.old_deterministic_proposal_value, 'OLD-REF');
    assert.equal(reference.reviewer_proposed_value, 'NEW-REF');
    assert.equal(reference.status, 'CANDIDATE_FOR_ENGINEER_REVIEW');
    assert.equal(ruleReport.rules_changed, 0);
    const allOutputs = fs.readdirSync(temporary)
      .map(name => fs.readFileSync(path.join(temporary, name), 'utf8')).join('\n');
    assert.doesNotMatch(allOutputs, /private rationale|reviewer\d@example|immutable evidence|changed evidence/);
    const reconciliation = JSON.parse(fs.readFileSync(path.join(temporary, 'reconciliation.json'), 'utf8'));
    assert.equal(reconciliation.reconciled, true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('checkpoint resumes after an interrupted GET without duplicate fixtures', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-learning-resume-'));
  const data = dataset(2);
  const mock = mockSupabase(data, { failAfterDecisionId: 1 });
  try {
    await assert.rejects(
      runExport(options(temporary, mock.fetchImpl, { decisionBatch: 1 })),
      /mock interrupted/,
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'checkpoint.json'), 'utf8')).input_decisions, 1);
    const result = await runExport(options(temporary, mock.fetchImpl, { decisionBatch: 1 }));
    assert.equal(result.input_decisions, 2);
    assert.equal(result.fixture_rows, 2);
    const fixtureLines = fs.readFileSync(path.join(temporary, 'fixture-candidates.jsonl'), 'utf8')
      .trim().split(/\r?\n/);
    assert.equal(fixtureLines.length, 2);
    assert.equal(new Set(fixtureLines.map(line => JSON.parse(line).packet_item_id)).size, 2);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('configuration requires explicit tables and enforces the 100,000-decision hard cap', () => {
  assert.throws(() => configFrom({
    baseUrl: 'https://review-only.example',
    key: 'key',
  }, {}), /DECISIONS_TABLE is required/);
  assert.throws(() => configFrom({
    baseUrl: 'https://review-only.example',
    key: 'key',
    decisionsTable: 'normalization_review_packet_decisions',
    itemsTable: 'normalization_review_packet_items',
    packetsTable: 'normalization_review_packets',
    sourceTable: 'watch_records',
    maxDecisions: 100_001,
  }, {}), /between 1 and 100000/);
  assert.throws(() => configFrom({
    baseUrl: 'https://review-only.example/not-an-origin',
    key: 'key',
    decisionsTable: 'normalization_review_packet_decisions',
    itemsTable: 'normalization_review_packet_items',
    packetsTable: 'normalization_review_packets',
    sourceTable: 'watch_records',
  }, {}), /HTTP\(S\) origin/);
});

test('exact-ID joins reject unrequested response lineage', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-learning-lineage-'));
  const data = dataset(1);
  const base = mockSupabase(data);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/normalization_review_packet_items')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ ...data.items[0], id: 'unexpected-item' }]),
      };
    }
    return base.fetchImpl(input, init);
  };
  try {
    await assert.rejects(
      runExport(options(temporary, fetchImpl)),
      /unrequested lineage id/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
