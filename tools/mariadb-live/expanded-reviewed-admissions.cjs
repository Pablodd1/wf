'use strict';

// Local evidence gate only. Callers may stream onAdmission rows to private files,
// but must wait for the final PASS receipt before staging any database approvals.
// The frozen parser and its historical output are never edited by this module.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const parser = require('./expanded-evidence-candidates.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { jsonLines } = require('./run-expanded-local-dry-run.cjs');

const CONTRACT = 'WF_EXPANDED_REVIEWED_ADMISSIONS_V1';
const SEALED = 'SEALED_REVIEWED_EXPANDED_ADMISSIONS_V1';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function boundDocument(pointer) {
  assert.ok(pointer && typeof pointer.file === 'string' && digest(pointer.sha256), 'ADMISSION_FILE_BINDING_REQUIRED');
  const bytes = await fs.promises.readFile(pointer.file);
  assert.equal(sha(bytes), pointer.sha256, 'ADMISSION_FILE_HASH_MISMATCH');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
function inside(directory, file) {
  const resolved = path.resolve(directory, file);
  const relative = path.relative(directory, resolved);
  assert.ok(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'ADMISSION_RAW_CHUNK_OUTSIDE_ARCHIVE');
  return resolved;
}

// Raw rows are visited in the original part/chunk order. Keep only the current
// source row and rebuilt parent, not the 1.5 million-row archive in memory.
function sourceReader(manifest, directory) {
  const chunks = new Map(manifest.chunks.map((chunk, index) => [chunk.file, { ...chunk, index }]));
  assert.equal(chunks.size, manifest.chunks.length, 'ADMISSION_RAW_CHUNK_DUPLICATE');
  let active = null, stream = null, rowIndex = -1, row = null, priorChunkIndex = -1;
  return {
    async get(pointer) {
      const chunk = chunks.get(pointer.raw_chunk);
      assert.ok(chunk && chunk.sha256 === pointer.raw_chunk_sha256, 'ADMISSION_RAW_CHUNK_BINDING_MISMATCH');
      assert.ok(Number.isInteger(pointer.row_index) && pointer.row_index >= 0 && pointer.row_index < chunk.rows, 'ADMISSION_RAW_ROW_INDEX_INVALID');
      if (active?.file !== chunk.file) {
        assert.ok(chunk.index > priorChunkIndex, 'ADMISSION_RAW_CHUNK_ORDER_INVALID');
        if (stream) await stream.return();
        const file = inside(directory, chunk.file);
        assert.equal(await hashFile(file), chunk.sha256, 'ADMISSION_RAW_CHUNK_HASH_MISMATCH');
        stream = jsonLines(file)[Symbol.asyncIterator](); active = chunk; rowIndex = -1; row = null; priorChunkIndex = chunk.index;
      }
      assert.ok(pointer.row_index >= rowIndex, 'ADMISSION_RAW_ROW_ORDER_INVALID');
      while (rowIndex < pointer.row_index) {
        const next = await stream.next(); assert.equal(next.done, false, 'ADMISSION_RAW_ROW_MISSING');
        rowIndex++; row = { raw: JSON.parse(next.value), source_hash: sha(next.value) };
      }
      assert.equal(String(row.raw.id), String(pointer.source_id), 'ADMISSION_SOURCE_ID_MISMATCH');
      assert.equal(row.source_hash, pointer.source_hash, 'ADMISSION_SOURCE_HASH_MISMATCH');
      return row.raw;
    },
    async close() { if (stream) await stream.return(); },
  };
}

async function verifyReviewedAdmissions({ reviewManifestFile, expectedReviewManifestSha256, policyHash, onAdmission }) {
  assert.ok(digest(expectedReviewManifestSha256) && digest(policyHash), 'ADMISSION_REVIEW_AND_POLICY_HASH_REQUIRED');
  assert.equal(typeof onAdmission, 'function', 'ADMISSION_PRIVATE_OUTPUT_SINK_REQUIRED');
  const review = await boundDocument({ file: reviewManifestFile, sha256: expectedReviewManifestSha256 });
  assert.equal(review.contract, CONTRACT, 'ADMISSION_CONTRACT_INVALID');
  assert.equal(review.status, SEALED, 'ADMISSION_MANIFEST_NOT_SEALED');
  assert.equal(review.policy_hash, policyHash, 'ADMISSION_POLICY_HASH_MISMATCH');
  assert.ok(Array.isArray(review.parts) && review.parts.length > 0, 'ADMISSION_PARTS_REQUIRED');
  assert.ok(Number.isSafeInteger(review.selected_candidate_count) && review.selected_candidate_count > 0, 'ADMISSION_SELECTION_COUNT_INVALID');
  const frozen = await boundDocument(review.parser_manifest);
  const source = await boundDocument(review.source_manifest);
  assert.equal(frozen.contract, 'WF_EXPANDED_LOCAL_DRY_RUN_V1', 'ADMISSION_PARSER_MANIFEST_CONTRACT_INVALID');
  assert.equal(frozen.status, 'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN', 'ADMISSION_FULL_PARSER_NOT_COMPLETE');
  assert.equal(frozen.parent_rows, source.rows, 'ADMISSION_SOURCE_POPULATION_MISMATCH');
  assert.equal(frozen.binding.source_manifest_file_sha256, review.source_manifest.sha256, 'ADMISSION_SOURCE_MANIFEST_FILE_MISMATCH');
  assert.equal(frozen.binding.source_manifest_sha256, source.manifest_sha256, 'ADMISSION_SOURCE_MANIFEST_MISMATCH');
  assert.equal(frozen.binding.parser_sha256, await hashFile(path.join(__dirname, 'expanded-evidence-candidates.cjs')), 'ADMISSION_PARSER_CODE_CHANGED');
  assert.equal(frozen.binding.runner_sha256, await hashFile(path.join(__dirname, 'run-expanded-local-dry-run.cjs')), 'ADMISSION_RUNNER_CODE_CHANGED');
  assert.deepEqual(frozen.binding.dependencies, parser.DEPENDENCY_HASHES, 'ADMISSION_PARSER_DEPENDENCIES_CHANGED');
  assert.ok(Array.isArray(source.chunks) && Array.isArray(frozen.parts), 'ADMISSION_MANIFEST_PARTS_INVALID');
  let lastPart = -1, totalRequested = 0;
  const selectionPaths = new Set();
  for (const part of review.parts) {
    assert.ok(Number.isInteger(part.parser_part_index) && part.parser_part_index > lastPart && part.parser_part_index < frozen.parts.length, 'ADMISSION_PART_ORDER_INVALID');
    lastPart = part.parser_part_index;
    assert.ok(part.selection && typeof part.selection.file === 'string' && digest(part.selection.sha256), 'ADMISSION_SELECTION_FILE_BINDING_REQUIRED');
    assert.ok(Number.isSafeInteger(part.selection.rows) && part.selection.rows > 0, 'ADMISSION_SELECTION_PART_COUNT_INVALID');
    assert.ok(!selectionPaths.has(path.resolve(part.selection.file)), 'ADMISSION_SELECTION_FILE_REUSED');
    selectionPaths.add(path.resolve(part.selection.file));
    totalRequested += part.selection.rows;
  }
  assert.equal(totalRequested, review.selected_candidate_count, 'ADMISSION_GLOBAL_SELECTION_COUNT_MISMATCH');
  const reader = sourceReader(source, path.dirname(path.resolve(review.source_manifest.file)));
  let admitted = 0, parents = 0, candidateRows = 0, lastSourceKey = null, rebuilt = null;
  const partReceipts = [];
  try {
    for (const selectedPart of review.parts) {
      const original = frozen.parts[selectedPart.parser_part_index].candidates;
      assert.ok(original && digest(original.sha256) && Number.isSafeInteger(original.rows), 'ADMISSION_CANDIDATE_PART_INVALID');
      assert.equal(await hashFile(original.file), original.sha256, 'ADMISSION_CANDIDATE_PART_HASH_MISMATCH');
      assert.equal(await hashFile(selectedPart.selection.file), selectedPart.selection.sha256, 'ADMISSION_SELECTION_PART_HASH_MISMATCH');
      const selected = new Map();
      for await (const line of jsonLines(selectedPart.selection.file)) {
        const item = JSON.parse(line);
        assert.deepEqual(Object.keys(item).sort(), ['candidate_hash', 'source_hash'], 'ADMISSION_SELECTION_FIELDS_INVALID');
        assert.ok(digest(item.candidate_hash) && digest(item.source_hash), 'ADMISSION_SELECTION_DIGEST_INVALID');
        assert.ok(!selected.has(item.candidate_hash), 'ADMISSION_DUPLICATE_SELECTED_CANDIDATE');
        selected.set(item.candidate_hash, item.source_hash);
        assert.ok(selected.size <= selectedPart.selection.rows, 'ADMISSION_SELECTION_PART_ROW_OVERFLOW');
      }
      assert.equal(selected.size, selectedPart.selection.rows, 'ADMISSION_SELECTION_PART_ROWS_MISMATCH');
      let rows = 0, accepted = 0;
      for await (const line of jsonLines(original.file)) {
        rows++; const stored = JSON.parse(line);
        if (!selected.has(stored.candidate_hash)) continue;
        assert.equal(stored.source_hash, selected.get(stored.candidate_hash), 'ADMISSION_SELECTED_SOURCE_HASH_MISMATCH');
        const canonical = stableJson(stored.candidate);
        assert.equal(sha(canonical), stored.candidate_hash, 'ADMISSION_CANDIDATE_CANONICAL_HASH_MISMATCH');
        const raw = await reader.get(stored);
        const sourceKey = stored.raw_chunk + ':' + stored.row_index + ':' + stored.source_hash;
        if (sourceKey !== lastSourceKey) {
          const result = parser.buildExpandedCandidates({ source_id: String(raw.id), source_hash: stored.source_hash, raw_payload: raw,
            source_system: source.source_system, source_database: source.source_database, source_table: source.source_table,
            canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' });
          rebuilt = new Map(result.candidates.map(entry => [entry.candidate_hash, entry])); lastSourceKey = sourceKey; parents++;
        }
        const exact = rebuilt.get(stored.candidate_hash);
        assert.ok(exact && exact.canonical_json === canonical, 'ADMISSION_CANDIDATE_NOT_EXACT_REBUILD');
        assert.equal(exact.candidate.decision.trading_floor, 'TF_SUPPORTED_CANDIDATE', 'ADMISSION_CANDIDATE_NOT_SUPPORTED');
        assert.deepEqual(exact.candidate.decision.reasons, [], 'ADMISSION_CANDIDATE_HAS_HOLDS');
        await onAdmission({ candidate_hash: stored.candidate_hash, source_hash: stored.source_hash, policy_hash: policyHash, review_manifest_sha256: expectedReviewManifestSha256 });
        selected.delete(stored.candidate_hash); accepted++; admitted++;
      }
      assert.equal(rows, original.rows, 'ADMISSION_CANDIDATE_PART_ROWS_MISMATCH');
      assert.equal(selected.size, 0, 'ADMISSION_SELECTED_CANDIDATE_ABSENT_FROM_PART');
      assert.equal(accepted, selectedPart.selection.rows, 'ADMISSION_SELECTED_PART_COUNT_MISMATCH');
      candidateRows += rows;
      partReceipts.push({ parser_part_index: selectedPart.parser_part_index, candidate_part_sha256: original.sha256, selected_part_sha256: selectedPart.selection.sha256, admitted: accepted });
    }
  } finally { await reader.close(); }
  assert.equal(admitted, review.selected_candidate_count, 'ADMISSION_FINAL_COUNT_MISMATCH');
  return { status: 'PASS_EXACT_REVIEWED_EXPANDED_ADMISSIONS', contract: CONTRACT, review_manifest_sha256: expectedReviewManifestSha256,
    policy_hash: policyHash, parser_manifest_sha256: review.parser_manifest.sha256, source_manifest_sha256: review.source_manifest.sha256,
    verified_admissions: admitted, rebuilt_parent_rows: parents, candidate_part_rows_checked: candidateRows, parts: partReceipts,
    production_mutations: 0, source_mutations: 0, database_queries: 0 };
}

module.exports = { CONTRACT, SEALED, verifyReviewedAdmissions };
