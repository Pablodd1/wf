'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  proposalSha256,
  sameOrigin,
  sha256,
  validateCorrection,
} = require('../api/_lib/review-packets.cjs');
const { runSnapshot, sanitizeProposal } = require('../tools/review-packets/snapshot-local.cjs');

const ROOT = path.join(__dirname, '..');
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

test('accepts only bounded structured correction proposals with both optimistic hashes', () => {
  const valid = validateCorrection({
    decision: 'CORRECTION_PROPOSED',
    fields: { reference: '116500LN', currency: null, price_usd: 30000 },
    rationale: 'The exact source line explicitly supports this proposal.',
    expectedRawSha256: HEX_A,
    expectedProposalSha256: HEX_B,
    evidenceHashes: [HEX_A, HEX_B],
  });
  assert.deepEqual(valid.value.fields, { reference: '116500LN', currency: null, price_usd: 30000 });

  assert.match(validateCorrection({
    decision: 'APPROVED',
    fields: { currency: 'USD' },
    rationale: 'Unsupported promotion.',
    expectedRawSha256: HEX_A,
    expectedProposalSha256: HEX_B,
    evidenceHashes: [HEX_A, HEX_B],
  }).error, /CORRECTION_PROPOSED/);
  assert.match(validateCorrection({
    decision: 'CORRECTION_PROPOSED',
    fields: { seller_phone: '+1 555 1212' },
    rationale: 'Contact is not a normalization field.',
    expectedRawSha256: HEX_A,
    expectedProposalSha256: HEX_B,
    evidenceHashes: [HEX_A, HEX_B],
  }).error, /supported correction/);
  assert.match(validateCorrection({
    decision: 'CORRECTION_PROPOSED',
    fields: { currency: 'USD' },
    rationale: 'Missing proposal evidence.',
    expectedRawSha256: HEX_A,
    expectedProposalSha256: HEX_B,
    evidenceHashes: [HEX_A, 'c'.repeat(64)],
  }).error, /include the expected/);
});

test('same-origin decision guard rejects cross-origin browser requests', () => {
  assert.equal(sameOrigin({ headers: { origin: 'https://watchfacts.example', host: 'watchfacts.example' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.example', host: 'watchfacts.example' } }), false);
  assert.equal(sameOrigin({ headers: { host: 'watchfacts.example' } }), true);
});

test('proposal fingerprints are stable across object key order', () => {
  assert.equal(
    proposalSha256({ reference: '5712/1A', brand: 'Patek Philippe' }),
    proposalSha256({ brand: 'Patek Philippe', reference: '5712/1A' }),
  );
});

test('local snapshot is bounded, reconciled, resumable-safe, and omits raw contact evidence', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-packets-'));
  const input = path.join(temporary, 'routing.jsonl');
  const output = path.join(temporary, 'snapshot');
  const raw = '[7/12] +852 6236 1307: Rolex 116500LN bare $30K';
  const rows = [
    {
      source_record_id: 'source-1',
      normalization_version: 'v4.2-line-condition',
      review_status: 'PENDING',
      review_reasons: ['CURRENCY_AMBIGUOUS'],
      raw_message: raw,
      frozen_proposal: {
        candidate_count: 1,
        proposed_candidates: [{
          brand: 'Rolex',
          reference: '116500LN',
          raw_line: raw,
          seller_phone: '+85262361307',
        }],
      },
    },
    {
      source_record_id: 'source-2',
      normalization_version: 'v4.2-line-condition',
      review_status: 'PENDING',
      change_flags: ['BUNDLE_SPLIT_REQUIRED'],
      raw_message_sha256: sha256('local immutable evidence two'),
      frozen_proposal: { candidate_count: 2, proposed_candidates: [] },
    },
    {
      source_record_id: 'source-2',
      normalization_version: 'v4.2-line-condition',
      review_status: 'PENDING',
      reason: 'BUNDLE_SPLIT_REQUIRED',
      raw_message_sha256: sha256('duplicate membership'),
      frozen_proposal: { candidate_count: 2, proposed_candidates: [] },
    },
  ];
  fs.writeFileSync(input, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);

  try {
    const result = await runSnapshot({ input, output, maxRows: 3, packetSize: 1, checkpointEvery: 1 });
    assert.equal(result.input_rows, 3);
    assert.equal(result.packet_item_rows, 2);
    assert.equal(result.error_rows, 1);
    assert.equal(result.reconciled, true);

    const itemText = fs.readFileSync(path.join(output, 'packet-items.jsonl'), 'utf8');
    assert.doesNotMatch(itemText, /6236|seller_phone|raw_line":/);
    assert.match(itemText, /raw_line_sha256/);
    const items = itemText.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(items[0].raw_message_sha256, sha256(raw));
    assert.equal(new Set(items.map(item => `${item.source_record_id}|${item.normalization_version}`)).size, 2);

    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.contains_raw_messages, false);
    assert.equal(manifest.contains_contact_data, false);
    assert.equal(manifest.database_writes, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'checkpoint.json'), 'utf8')).complete, true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('local snapshot resumes from its byte-offset checkpoint without duplicating membership', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-resume-'));
  const input = path.join(temporary, 'routing.jsonl');
  const output = path.join(temporary, 'snapshot');
  const rows = ['resume-1', 'resume-2'].map(sourceRecordId => ({
    source_record_id: sourceRecordId,
    normalization_version: 'v4.2-line-condition',
    review_status: 'PENDING',
    reason: 'DETERMINISTIC_CHANGE_REVIEW',
    raw_message_sha256: sha256(sourceRecordId),
    frozen_proposal: { candidate_count: 1, proposed_candidates: [{ reference: sourceRecordId }] },
  }));
  fs.writeFileSync(input, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);

  try {
    await assert.rejects(
      runSnapshot({ input, output, maxRows: 1, packetSize: 2, checkpointEvery: 1 }),
      /exceeds bounded maxRows=1/,
    );
    const resumed = await runSnapshot({ input, output, maxRows: 2, packetSize: 2, checkpointEvery: 1 });
    assert.equal(resumed.packet_item_rows, 2);
    const items = fs.readFileSync(path.join(output, 'packet-items.jsonl'), 'utf8').trim().split(/\r?\n/);
    assert.equal(items.length, 2);
    assert.equal(new Set(items.map(line => JSON.parse(line).id)).size, 2);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('local snapshot rejects changed resume packet size and input/output collisions', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-settings-'));
  const input = path.join(temporary, 'routing.jsonl');
  const output = path.join(temporary, 'snapshot');
  const row = {
    source_record_id: 'settings-1',
    normalization_version: 'v4.2-line-condition',
    review_status: 'PENDING',
    reason: 'DETERMINISTIC_CHANGE_REVIEW',
    raw_message_sha256: sha256('settings evidence'),
    frozen_proposal: { candidate_count: 1, proposed_candidates: [{ reference: 'settings-1' }] },
  };
  fs.writeFileSync(input, `${JSON.stringify(row)}\n${JSON.stringify({ ...row, source_record_id: 'settings-2' })}\n`);

  try {
    await assert.rejects(
      runSnapshot({ input, output, maxRows: 1, packetSize: 2, checkpointEvery: 1 }),
      /exceeds bounded maxRows=1/,
    );
    await assert.rejects(
      runSnapshot({ input, output, maxRows: 2, packetSize: 1, checkpointEvery: 1 }),
      /packetSize does not match/,
    );
    const collidingInput = path.join(temporary, 'packet-items.jsonl');
    fs.writeFileSync(collidingInput, `${JSON.stringify(row)}\n`);
    await assert.rejects(
      runSnapshot({
        input: collidingInput,
        output: temporary,
        maxRows: 1,
        packetSize: 2,
        checkpointEvery: 1,
      }),
      /cannot be one of the snapshot output files/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('packet schema is immutable, service-only, stale-aware, and has no watch_records write path', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260726150000_normalization_review_packets.sql'),
    'utf8',
  );
  assert.match(sql, /UNIQUE \(source_record_id, normalization_version\)/i);
  assert.match(sql, /UNIQUE \(packet_id, ordinal\)/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.normalization_review_packet_items/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.normalization_review_packet_items FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT ON public\.normalization_review_packet_items TO service_role/i);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = ''/i);
  assert.match(sql, /SELECT item\.\*[\s\S]*INTO v_item[\s\S]*FOR SHARE OF item/i);
  assert.match(sql, /SELECT source\.raw_message[\s\S]*INTO v_raw_message[\s\S]*FOR SHARE OF source/i);
  assert.doesNotMatch(sql, /SELECT item,\s*source\.raw_message[\s\S]*INTO v_item,\s*v_raw_message/i);
  assert.match(sql, /STALE_PACKET_ITEM|STALE_SOURCE_EVIDENCE/);
  assert.match(sql, /CORRECTION_PROPOSED/);
  assert.doesNotMatch(sql, /(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.watch_records/i);
});

test('packet routes remain reviewer-only, private, bounded, lazy, and same-origin for decisions', () => {
  const summaries = fs.readFileSync(path.join(ROOT, 'api', 'review-packets.js'), 'utf8');
  const evidence = fs.readFileSync(path.join(ROOT, 'api', 'review-packet-item.js'), 'utf8');
  const decision = fs.readFileSync(path.join(ROOT, 'api', 'review-packet-decision.js'), 'utf8');
  for (const route of [summaries, evidence, decision]) {
    assert.match(route, /new Set\(\['reviewer', 'admin'\]\)/);
    assert.match(route, /Cache-Control', 'private, no-store/);
  }
  assert.match(summaries, /boundedInteger\(req\.query\?\.limit, 50, 1, 100\)/);
  assert.match(summaries, /\.gt\('ordinal', afterOrdinal\)/);
  assert.match(evidence, /redactPublicSource\(source\.raw_message/);
  assert.match(evidence, /\/api\/reviewer-contact-reveal/);
  assert.match(decision, /if \(!sameOrigin\(req\)\)/);
  assert.match(decision, /watchRecordsMutated: false/);
});

test('proposal sanitizer removes duplicated private evidence keys', () => {
  assert.deepEqual(sanitizeProposal({
    reference: '52506',
    raw_message: 'secret source',
    raw_line: 'exact line',
    observed_name: 'Private Dealer',
    candidate: { currency: null, contact: '+1 555' },
  }), {
    reference: '52506',
    raw_message_sha256: sha256('secret source'),
    raw_line_sha256: sha256('exact line'),
    candidate: { currency: null },
  });
});
