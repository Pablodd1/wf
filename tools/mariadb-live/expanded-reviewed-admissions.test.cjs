'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { CONTRACT, SEALED, verifyReviewedAdmissions } = require('./expanded-reviewed-admissions.cjs');
const parser = require('./expanded-evidence-candidates.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const policy = 'd'.repeat(64);

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-admissions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bind = (name, bytes) => {
    const file = path.join(directory, name); fs.writeFileSync(file, bytes);
    return { file, sha256: sha(bytes) };
  };
  const gzip = (name, rows) => ({ ...bind(name, zlib.gzipSync(rows.map(x => stableJson(x)).join('\n') + '\n')), rows: rows.length });
  const doc = (name, value) => bind(name, JSON.stringify(value));
  const rawRows = [
    { id: 'SYNTHETIC-A', title: 'Rolex\nWTS\n116500LN asking USD 25000\n116500LN asking USD 25000\n126610LN asking USD 14000', type: 'sale', brand: 'Rolex', is_bundle: 1, status: 'ended' },
    { id: 'SYNTHETIC-B', title: 'WTS Rolex 116500LN asking HKD 1.0\u200c65M\u2028Full set', type: 'sale', brand: 'Rolex', is_bundle: 0, status: 'ended' },
  ];
  const chunk = gzip('raw.jsonl.gz', rawRows);
  const source = { source_system: 'SYNTHETIC', source_database: 'test', source_table: 'auctions', rows: 2, manifest_sha256: 'a'.repeat(64), chunks: [{ file: 'raw.jsonl.gz', sha256: chunk.sha256, rows: 2 }] };
  const sourcePointer = doc('source-manifest.json', source);
  const records = rawRows.map((raw, rowIndex) => parser.buildExpandedCandidates({ source_id: raw.id, source_hash: sha(stableJson(raw)), raw_payload: raw,
    source_system: source.source_system, source_database: source.source_database, source_table: source.source_table, canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' }).candidates.map(entry => ({
    source_id: raw.id, source_hash: sha(stableJson(raw)), raw_chunk: 'raw.jsonl.gz', raw_chunk_sha256: chunk.sha256, row_index: rowIndex,
    candidate_hash: entry.candidate_hash, candidate: entry.candidate,
  })));
  assert.deepEqual(records.map(rows => rows.length), [2, 1]);
  for (const row of records.flat()) assert.equal(row.candidate.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE');
  const frozen = { contract: 'WF_EXPANDED_LOCAL_DRY_RUN_V1', status: 'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN', parent_rows: 2,
    binding: { source_manifest_sha256: source.manifest_sha256, source_manifest_file_sha256: sourcePointer.sha256,
      parser_sha256: sha(fs.readFileSync(path.join(__dirname, 'expanded-evidence-candidates.cjs'))),
      runner_sha256: sha(fs.readFileSync(path.join(__dirname, 'run-expanded-local-dry-run.cjs'))), dependencies: parser.DEPENDENCY_HASHES },
    parts: records.map((rows, index) => ({ candidates: gzip(index + '.candidates.jsonl.gz', rows) })),
  };
  const selections = records.map(rows => rows.map(row => ({ candidate_hash: row.candidate_hash, source_hash: row.source_hash })));
  const review = { contract: CONTRACT, status: SEALED, policy_hash: policy, parser_manifest: doc('parser-manifest.json', frozen), source_manifest: sourcePointer,
    parts: selections.map((rows, index) => ({ parser_part_index: index, selection: gzip(index + '.selected.jsonl.gz', rows) })), selected_candidate_count: 3 };
  let reviewPointer = doc('review-manifest.json', review);
  const reseal = () => { review.parser_manifest = doc('parser-manifest.json', frozen); reviewPointer = doc('review-manifest.json', review); };
  const run = async () => {
    const admissions = [];
    const receipt = await verifyReviewedAdmissions({ reviewManifestFile: reviewPointer.file, expectedReviewManifestSha256: reviewPointer.sha256,
      policyHash: policy, onAdmission: async row => { admissions.push(row); } });
    return { admissions, receipt, globalHash: reviewPointer.sha256 };
  };
  return { directory, records, selections, frozen, review, gzip, doc, reseal, run, pointer: () => reviewPointer };
}

test('sealed multi-part replay verifies immutable raw, collapsed spans, Unicode and one global review hash', async t => {
  const f = fixture(t); const before = sha(fs.readFileSync(path.join(f.directory, 'raw.jsonl.gz')));
  assert.equal(f.records[0][0].candidate.source_spans.length, 2);
  const result = await f.run();
  assert.equal(result.receipt.status, 'PASS_EXACT_REVIEWED_EXPANDED_ADMISSIONS');
  assert.equal(result.receipt.verified_admissions, 3); assert.equal(result.receipt.rebuilt_parent_rows, 2);
  assert.equal(result.receipt.database_queries, 0);
  for (const row of result.admissions) { assert.equal(row.review_manifest_sha256, result.globalHash); assert.equal(row.policy_hash, policy); }
  assert.equal(sha(fs.readFileSync(path.join(f.directory, 'raw.jsonl.gz'))), before);
});

test('only reviewed selected candidates are emitted, never all otherwise supported candidates', async t => {
  const f = fixture(t); f.selections[0] = f.selections[0].slice(1);
  f.review.parts[0].selection = f.gzip('0.selected.jsonl.gz', f.selections[0]); f.review.selected_candidate_count = 2; f.reseal();
  const result = await f.run(); assert.equal(result.admissions.length, 2);
  assert.ok(!result.admissions.some(row => row.candidate_hash === f.records[0][0].candidate_hash));
});

for (const field of ['brand', 'currency', 'intent', 'empty_proof']) {
  test('self-rehashed forged ' + field + ' fails exact JS rebuild despite a fully resealed file chain', async t => {
    const f = fixture(t); const row = f.records[0][0];
    if (field === 'brand') row.candidate.fields.brand = 'Patek Philippe';
    if (field === 'currency') row.candidate.fields.original_price_currency = 'HKD';
    if (field === 'intent') row.candidate.fields.intent = 'WTB';
    if (field === 'empty_proof') row.candidate.evidence.brand = [{}];
    row.candidate_hash = sha(stableJson(row.candidate)); f.selections[0][0].candidate_hash = row.candidate_hash;
    f.frozen.parts[0].candidates = f.gzip('0.candidates.jsonl.gz', f.records[0]);
    f.review.parts[0].selection = f.gzip('0.selected.jsonl.gz', f.selections[0]); f.reseal();
    await assert.rejects(f.run(), /ADMISSION_CANDIDATE_NOT_EXACT_REBUILD/);
  });
}

test('unsealed review and unfinished parser cannot authorize staging', async t => {
  const f = fixture(t); f.review.status = 'PENDING_ROOT_REVIEW'; f.reseal();
  await assert.rejects(f.run(), /ADMISSION_MANIFEST_NOT_SEALED/);
  f.review.status = SEALED; f.frozen.status = 'RUNNING'; f.reseal();
  await assert.rejects(f.run(), /ADMISSION_FULL_PARSER_NOT_COMPLETE/);
});

test('changed source bytes are rejected against the immutable raw chunk hash', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.directory, 'raw.jsonl.gz'), 'tamper');
  await assert.rejects(f.run(), /ADMISSION_RAW_CHUNK_HASH_MISMATCH/);
});

test('selection source-hash change and absent candidate cannot piggyback on reviewed parts', async t => {
  const f = fixture(t); f.selections[0][0].source_hash = '0'.repeat(64);
  f.review.parts[0].selection = f.gzip('0.selected.jsonl.gz', f.selections[0]); f.reseal();
  await assert.rejects(f.run(), /ADMISSION_SELECTED_SOURCE_HASH_MISMATCH/);
  f.selections[0][0].source_hash = f.records[0][0].source_hash; f.selections[0][0].candidate_hash = '1'.repeat(64);
  f.review.parts[0].selection = f.gzip('0.selected.jsonl.gz', f.selections[0]); f.reseal();
  await assert.rejects(f.run(), /ADMISSION_SELECTED_CANDIDATE_ABSENT_FROM_PART/);
});

test('duplicate selected records and repeated or descending parser parts are rejected', async t => {
  const f = fixture(t); f.selections[0].push(f.selections[0][0]); f.review.selected_candidate_count++;
  f.review.parts[0].selection = f.gzip('0.selected.jsonl.gz', f.selections[0]); f.reseal();
  await assert.rejects(f.run(), /ADMISSION_DUPLICATE_SELECTED_CANDIDATE/);
  f.review.parts.reverse(); f.reseal(); await assert.rejects(f.run(), /ADMISSION_PART_ORDER_INVALID/);
});

test('review hash, file hash and parser identity drift each fail closed', async t => {
  const f = fixture(t);
  await assert.rejects(verifyReviewedAdmissions({ reviewManifestFile: f.pointer().file, expectedReviewManifestSha256: '0'.repeat(64), policyHash: policy, onAdmission: async () => {} }), /ADMISSION_FILE_HASH_MISMATCH/);
  f.frozen.binding.parser_sha256 = '0'.repeat(64); f.reseal(); await assert.rejects(f.run(), /ADMISSION_PARSER_CODE_CHANGED/);
});
