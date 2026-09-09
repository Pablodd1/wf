'use strict';
// Local only. Inspect immutable V1 proposals and rebuild only affected parents
// under cumulative V3 (which includes V2). All V1/V2/raw outputs stay immutable.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const v1 = require('./expanded-evidence-candidates.cjs');
const v2 = require('./expanded-evidence-candidates-v2.cjs');
const v3 = require('./expanded-evidence-candidates-v3.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { jsonLines } = require('./run-expanded-local-dry-run.cjs');
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
async function hashFile(file) { const h = crypto.createHash('sha256'); for await(const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); }
async function save(file, value) {
  const temp = file + '.' + process.pid + '.pending';
  await fs.promises.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  for(let i = 0;; i++) { try { await fs.promises.rename(temp, file); return; } catch(e) { if(!['EPERM','EACCES','EBUSY'].includes(e.code) || i >= 5) throw e; await new Promise(r => setTimeout(r, 100 * (i + 1))); } }
}
const findScopeIssues = v3.inspectLegacyCandidateScope;
async function writeRows(file, rows) {
  const bytes = zlib.gzipSync(rows.map(r => JSON.stringify(r) + '\n').join(''));
  if(fs.existsSync(file)) { assert.equal(sha(fs.readFileSync(file)), sha(bytes), 'UNREGISTERED_OUTPUT_MISMATCH'); }
  else fs.writeFileSync(file, bytes, { flag: 'wx' });
  return { file, sha256: sha(bytes), rows: rows.length, bytes: bytes.length };
}
async function run(config) {
  const output = path.resolve(config.output_directory); fs.mkdirSync(output, { recursive: true });
  const sourceFile = path.resolve(config.source_manifest), source = read(sourceFile), sourceDir = path.dirname(sourceFile);
  const baseDirectory = path.resolve(config.base_run_directory);
  const frozenBase = path.join(baseDirectory, 'manifest.json');
  const base = read(fs.existsSync(frozenBase) ? frozenBase : path.join(baseDirectory, 'checkpoint.json'));
  const files = ['expanded-evidence-candidates.cjs', 'expanded-evidence-candidates-v2.cjs', 'expanded-evidence-candidates-v3.cjs', 'expanded-reference-anchor-policy-v2.cjs', 'expanded-source-scope-policy-v3.cjs', path.basename(__filename)];
  const binding = { source_manifest: { file: sourceFile, sha256: await hashFile(sourceFile) }, base_binding: base.binding,
    parser_files: Object.fromEntries(await Promise.all(files.map(async f => [f, await hashFile(path.join(__dirname, f))]))) };
  assert.equal(base.binding.parser_sha256, v3.DEPENDENCY_HASHES.base_parser);
  assert.equal(base.binding.source_manifest_file_sha256, binding.source_manifest.sha256);
  const checkpointFile = path.join(output, 'checkpoint.json');
  const state = fs.existsSync(checkpointFile) ? read(checkpointFile) : { contract: 'WF_EXPANDED_SOURCE_SCOPE_CORRECTIONS_V3', status: 'RUNNING_LOCAL_ONLY', started_at: new Date().toISOString(), binding, supersession:'ALL_OLDER_V1_AND_V2_CANDIDATES_OF_EACH_AFFECTED_PARENT', processed_parts: [], correction_parts: [], counts: { scanned_candidates: 0, affected_parents: 0, unique_scope_issue_spans: 0, implicated_original_candidates: 0, original_candidates: 0, previous_v2_candidates:0, repaired_candidates: 0, repaired_supported: 0 }, reasons: {} };
  assert.deepEqual(state.binding, binding, 'CORRECTION_POLICY_OR_BASE_CHANGED');
  for(const p of state.processed_parts) assert.equal(base.parts[p.original_parser_part_index].candidates.sha256, p.original_candidates.sha256);
  for(const p of state.correction_parts) for(const name of ['candidates','affected_parents']) assert.equal(await hashFile(p[name].file), p[name].sha256);
  const maxParts = Math.min(config.max_parts ?? base.parts.length, base.parts.length);
  let rawIterator = null, rawChunk = null, rawIndex = -1, rawLine = null;
  async function getRaw(pointer) {
    const file = path.join(sourceDir, pointer.raw_chunk);
    if(rawChunk !== file) {
      if(rawIterator) await rawIterator.return();
      assert.equal(await hashFile(file), pointer.raw_chunk_sha256);
      rawIterator = jsonLines(file)[Symbol.asyncIterator](); rawChunk = file; rawIndex = -1;
    }
    assert.ok(pointer.row_index >= rawIndex, 'NONMONOTONIC_RAW_POINTER');
    while(rawIndex < pointer.row_index) { const r = await rawIterator.next(); assert.equal(r.done, false); rawLine = r.value; rawIndex++; }
    assert.equal(sha(rawLine), pointer.source_hash); const raw = JSON.parse(rawLine);
    assert.equal(String(raw.id), pointer.source_id); assert.equal(stableJson(raw), rawLine);
    return { source_id: pointer.source_id, source_hash: pointer.source_hash, raw_payload: raw, source_system: source.source_system, source_database: source.source_database, source_table: source.source_table, canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' };
  }
  try {
    for(let i = state.processed_parts.length; i < maxParts; i++) {
      assert.ok(fs.statfsSync(output).bavail * fs.statfsSync(output).bsize > (config.minimum_free_bytes || 50 * 1024 ** 3), 'DISK_CAPACITY_GUARD');
      const part = base.parts[i], affected = []; let group = null, rowCount = 0;
      const finish = () => { if(group?.issues.length) affected.push(group); group = null; };
      assert.equal(await hashFile(part.candidates.file), part.candidates.sha256);
      for await(const line of jsonLines(part.candidates.file)) {
        const row = JSON.parse(line); rowCount++;
        if(group && group.source_id !== row.source_id) finish();
        if(!group) group = { source_id: row.source_id, source_hash: row.source_hash, raw_chunk: row.raw_chunk, raw_chunk_sha256: row.raw_chunk_sha256, row_index: row.row_index, original_candidate_hashes: [], issues: [] };
        assert.equal(group.source_hash, row.source_hash);
        group.original_candidate_hashes.push(row.candidate_hash);
        group.issues.push(...findScopeIssues(row.candidate).map(issue => ({ ...issue, original_candidate_hash: row.candidate_hash })));
      }
      finish(); assert.equal(rowCount, part.candidates.rows);
      const rebuiltRows = [], repairedParents = [];
      for(const parent of affected) {
        const staged = await getRaw(parent), before = v1.buildExpandedCandidates(staged), previous = v2.buildExpandedCandidates(staged), after = v3.buildExpandedCandidates(staged);
        assert.deepEqual(before.candidates.map(c => c.candidate_hash), parent.original_candidate_hashes, 'EXACT_ORIGINAL_PARENT_REBUILD_MISMATCH');
        assert.ok(parent.issues.length > 0);
        const uniqueIssues=new Map();
        for(const issue of parent.issues){const key=stableJson([issue.reason,issue.field,issue.start,issue.end,issue.quote_sha256]);let prior=uniqueIssues.get(key);if(!prior){const {original_candidate_hash,...proof}=issue;prior={...proof,original_candidate_hashes:[]};uniqueIssues.set(key,prior);}if(!prior.original_candidate_hashes.includes(issue.original_candidate_hash))prior.original_candidate_hashes.push(issue.original_candidate_hash);}
        const repaired = { ...parent, issues:[...uniqueIssues.values()], original_parser_part_index: i, previous_v2_candidate_hashes:previous.candidates.map(c=>c.candidate_hash), repaired_candidate_hashes: after.candidates.map(c => c.candidate_hash), parent_outcome: after.parent_outcome, residuals: after.residuals, supersedes_all_older_candidates_for_parent:true, review_status: 'PENDING_REVIEW_NOT_PUBLICATION_AUTHORITY' };
        repairedParents.push(repaired);
        for(const entry of after.candidates) rebuiltRows.push({ source_id: parent.source_id, source_hash: parent.source_hash, raw_chunk: parent.raw_chunk, raw_chunk_sha256: parent.raw_chunk_sha256, row_index: parent.row_index, candidate_hash: entry.candidate_hash, candidate: entry.candidate });
        state.counts.affected_parents++; state.counts.unique_scope_issue_spans += uniqueIssues.size;
        state.counts.implicated_original_candidates += new Set(parent.issues.map(x=>x.original_candidate_hash)).size;
        state.counts.previous_v2_candidates += previous.candidates.length;
        state.counts.original_candidates += before.candidates.length; state.counts.repaired_candidates += after.candidates.length;
        state.counts.repaired_supported += after.candidates.filter(e => e.candidate.decision.trading_floor === 'TF_SUPPORTED_CANDIDATE').length;
        for(const issue of uniqueIssues.values()) state.reasons[issue.reason] = (state.reasons[issue.reason] || 0) + 1;
      }
      if(affected.length) {
        const prefix = path.join(output, String(i).padStart(6, '0'));
        state.correction_parts.push({ original_parser_part_index: i, original_candidates: part.candidates,
          candidates: await writeRows(prefix + '.candidates.jsonl.gz', rebuiltRows), affected_parents: await writeRows(prefix + '.affected-parents.jsonl.gz', repairedParents) });
      }
      state.counts.scanned_candidates += rowCount;
      state.processed_parts.push({ original_parser_part_index: i, original_candidates: part.candidates, affected_parents: affected.length });
      state.updated_at = new Date().toISOString(); await save(checkpointFile, state);
      if(i % 100 === 99) console.log(JSON.stringify({event:'CORRECTION_PART_PROGRESS', parts:i+1, counts:state.counts}));
    }
    const complete = base.status === 'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN' && state.processed_parts.length === base.parts.length;
    state.status = complete ? 'COMPLETE_LOCAL_CORRECTION_REBUILD_PENDING_REVIEW' : 'PASS_COMPLETED_PREFIX_PENDING_FULL_SOURCE';
    if(complete) state.base_parser_manifest = { file: frozenBase, sha256: await hashFile(frozenBase) };
    state.updated_at = new Date().toISOString(); await save(checkpointFile, state);
    if(complete) await save(path.join(output, 'manifest.json'), state);
    console.log(JSON.stringify({status:state.status, counts:state.counts, checkpoint:checkpointFile})); return state;
  } finally { if(rawIterator) await rawIterator.return(); }
}
if(require.main === module) run(read(process.argv[2])).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { findScopeIssues, run };
