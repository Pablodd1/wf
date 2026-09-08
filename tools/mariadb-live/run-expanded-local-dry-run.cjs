'use strict';
// Immutable local archive -> compressed candidate/issue parts. No database or
// network clients. A completed part is hash-bound before its checkpoint advances.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
const assert = require('node:assert/strict');
const parser = require('./expanded-evidence-candidates.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const bump = (map, key, count = 1) => { map[key] = (map[key] || 0) + count; };

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function* jsonLines(file) {
  // Node readline also treats Unicode line separators inside valid JSON strings
  // as line endings. The immutable archive format is specifically LF-delimited.
  const source = fs.createReadStream(file), unzip = zlib.createGunzip();
  source.on('error', error => unzip.destroy(error));
  source.pipe(unzip);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    for await (const bytes of unzip) {
      pending += decoder.write(bytes);
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line) yield line;
      }
    }
    pending += decoder.end();
    if (pending) yield pending;
  } finally { unzip.destroy(); source.destroy(); }
}
async function rename(from, to) {
  for (let attempt = 0;; attempt++) {
    try { await fs.promises.rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
async function save(file, value) {
  const temp = file + '.pending';
  await fs.promises.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, file);
}
function freeBytes(directory) {
  const stat = fs.statfsSync(directory);
  return stat.bavail * stat.bsize;
}
async function writer(file) {
  if (fs.existsSync(file)) await rename(file, file + '.uncheckpointed-' + Date.now());
  const temp = file + '.pending-' + process.pid;
  const compressed = zlib.createGzip({ level: 6 });
  const output = fs.createWriteStream(temp, { flags: 'wx' });
  let failure = null;
  compressed.on('error', error => { failure = error; });
  compressed.pipe(output);
  output.on('error', error => compressed.destroy(error));
  const completed = finished(output);
  completed.catch(() => {});
  let rows = 0;
  return {
    async add(value) {
      if (failure) throw failure;
      if (!compressed.write(JSON.stringify(value) + '\n')) await once(compressed, 'drain');
      rows++;
    },
    async close() {
      compressed.end();
      await completed;
      await rename(temp, file);
      return { file, rows, bytes: fs.statSync(file).size, sha256: await hashFile(file) };
    },
    abort() { compressed.destroy(); output.destroy(); },
  };
}
function thinSpan(span) { const { quote, ...thin } = span; return thin; }

async function run(config, testControls = {}) {
  assert.ok(config.source_manifest && config.output_directory, 'EXPLICIT_LOCAL_PATHS_REQUIRED');
  const manifestFile = path.resolve(config.source_manifest);
  const manifest = read(manifestFile);
  const rawDir = path.dirname(manifestFile);
  const outputDir = path.resolve(config.output_directory);
  fs.mkdirSync(outputDir, { recursive: true });
  const progressFile = path.join(outputDir, 'checkpoint.json');
  const batchSize = config.batch_parents || 250;
  assert.ok(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 1000);
  const maxParents = config.max_parents ?? manifest.rows;
  assert.ok(Number.isInteger(maxParents) && maxParents > 0 && maxParents <= manifest.rows);
  const minFree = config.minimum_free_bytes ?? 50 * 1024 ** 3;
  const selected = config.chunk_indices || manifest.chunks.map((_, index) => index);
  assert.equal(new Set(selected).size, selected.length);
  for (const i of selected) assert.ok(Number.isInteger(i) && i >= 0 && i < manifest.chunks.length);
  const perChunk = config.max_parents_per_chunk ?? null;
  if (perChunk != null) assert.ok(Number.isInteger(perChunk) && perChunk > 0);
  const quarantine = config.quarantine_receipt ? read(config.quarantine_receipt) : null;
  const quarantineIds = new Map((quarantine?.rows || []).map(r => [r.source_id, r.source_hash]));
  const binding = {
    source_manifest_sha256: manifest.manifest_sha256,
    source_manifest_file_sha256: await hashFile(manifestFile),
    parser_sha256: await hashFile(path.join(__dirname, 'expanded-evidence-candidates.cjs')),
    runner_sha256: await hashFile(__filename),
    dependencies: parser.DEPENDENCY_HASHES,
    config_sha256: sha(JSON.stringify(config)),
    quarantine_receipt_sha256: config.quarantine_receipt ? await hashFile(config.quarantine_receipt) : null,
  };
  let state = fs.existsSync(progressFile) ? read(progressFile) : {
    contract: 'WF_EXPANDED_LOCAL_DRY_RUN_V1', status: 'RUNNING', started_at: new Date().toISOString(),
    binding, parent_rows: 0, candidate_rows: 0, parts: [], cursor: { selection_index: 0, row_index: 0 },
    counts: {}, candidate_reasons: {}, price_reasons: {}, warnings: {}, intent_tiers: {}, price_currencies: {},
    parent_residual_reasons: {}, samples: {}, initial_free_bytes: freeBytes(outputDir),
  };
  assert.deepEqual(state.binding, binding, 'RESUME_INPUT_OR_CODE_CHANGED');
  if (state.status.startsWith('PASS_')) return state;
  for (const part of state.parts) {
    for (const key of ['candidates', 'parents']) assert.equal(await hashFile(part[key].file), part[key].sha256, 'COMPLETED_PART_HASH_MISMATCH');
  }
  let part = null, partParents = 0;
  const openPart = async () => {
    assert.ok(freeBytes(outputDir) >= minFree, 'LOCAL_DISK_RESERVE_REACHED');
    const name = String(state.parts.length).padStart(6, '0');
    part = { candidates: await writer(path.join(outputDir, name + '.candidates.jsonl.gz')), parents: await writer(path.join(outputDir, name + '.parents.jsonl.gz')) };
    partParents = 0;
  };
  const closePart = async () => {
    if (!part) return;
    const candidates = await part.candidates.close();
    const parents = await part.parents.close();
    state.parts.push({ candidates, parents, completed_cursor: { ...state.cursor } });
    state.updated_at = new Date().toISOString();
    state.free_bytes = freeBytes(outputDir);
    await save(progressFile, state);
    if (config.public_progress_file) {
      const { samples, ...summary } = state;
      await save(path.resolve(config.public_progress_file), { ...summary, private_output_directory: outputDir });
    }
    console.log(JSON.stringify({ event: 'EXPANDED_LOCAL_PART_COMPLETE', parents: state.parent_rows, candidates: state.candidate_rows, counts: state.counts, parts: state.parts.length, free_bytes: state.free_bytes }));
    part = null;
    if (testControls.interruptAfterParts === state.parts.length) throw new Error('TEST_CHECKPOINT_INTERRUPT');
  };
  const sample = (key, row) => {
    const list = state.samples[key] ||= [];
    if (list.length < 3) list.push(row);
  };
  try {
    outer: for (let selectionIndex = state.cursor.selection_index; selectionIndex < selected.length; selectionIndex++) {
      const chunkIndex = selected[selectionIndex], chunk = manifest.chunks[chunkIndex];
      const file = path.join(rawDir, chunk.file);
      assert.ok(file.startsWith(rawDir + path.sep), 'SOURCE_CHUNK_OUTSIDE_ARCHIVE');
      assert.equal(await hashFile(file), chunk.sha256, 'SOURCE_CHUNK_HASH_MISMATCH');
      let rowIndex = 0;
        for await (const line of jsonLines(file)) {
          if (!line) continue;
          const index = rowIndex++;
          if (selectionIndex === state.cursor.selection_index && index < state.cursor.row_index) continue;
          if (perChunk != null && index >= perChunk) break;
          if (state.parent_rows >= maxParents) break outer;
          if (!part) await openPart();
          const raw = JSON.parse(line), sourceHash = sha(line);
          const sourcePointer = { source_id: raw.id, source_hash: sourceHash, raw_chunk: chunk.file, raw_chunk_sha256: chunk.sha256, row_index: index };
          let result;
          if (quarantineIds.has(raw.id)) {
            assert.equal(sourceHash, quarantineIds.get(raw.id), 'QUARANTINE_SOURCE_HASH_MISMATCH');
            result = { source_id: raw.id, source_hash: sourceHash, parent_source_field: null, parent_field_hash: null, source_status: raw.status ?? null, source_type: raw.type ?? null, parent_outcome: 'REVIEW', is_explicit_bundle: Number(raw.is_bundle) === 1, candidates: [], residuals: [{ reason: 'PROVENANCE_LOSSLESS_REVIEW_REQUIRED', evidence: [] }] };
          } else {
            result = parser.buildExpandedCandidates({
              source_id: String(raw.id), source_hash: sourceHash, raw_payload: raw,
              source_system: manifest.source_system, source_database: manifest.source_database, source_table: manifest.source_table,
              canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256',
            });
          }
          const issues = [];
          if (result.identical_blocks_collapsed) bump(state.counts, 'IDENTICAL_PARENT_BLOCKS_COLLAPSED', result.identical_blocks_collapsed);
          for (const entry of result.candidates) {
            const c = entry.candidate, decision = c.decision;
            const candidateLine = state.candidate_rows;
            await part.candidates.add({ ...sourcePointer, candidate_hash: entry.candidate_hash, candidate: c });
            state.candidate_rows++;
            bump(state.counts, c.kind + '_' + decision.trading_floor);
            if (decision.price_source === 'SOURCE_PRICE_SUPPORTED_REQUIRES_FX_AND_ADMISSION') bump(state.counts, c.kind + '_SOURCE_PRICE_SUPPORTED');
            for (const reason of decision.reasons) bump(state.candidate_reasons, reason);
            for (const reason of decision.price_reasons) bump(state.price_reasons, reason);
            for (const reason of decision.warnings) bump(state.warnings, reason);
            bump(state.intent_tiers, c.intent_evidence_tier || 'UNRESOLVED');
            bump(state.price_currencies, c.fields.original_price_currency || 'NULL');
            const issue = { candidate_hash: entry.candidate_hash, kind: c.kind, child_index: c.child_index, decision, source_spans: c.source_spans.map(thinSpan) };
            issues.push(issue);
            sample(c.kind + '|' + decision.trading_floor + '|' + (decision.reasons[0] || c.intent_evidence_tier), { ...sourcePointer, candidate_hash: entry.candidate_hash, candidate_line_global: candidateLine, part_index: state.parts.length });
          }
          const residuals = result.residuals.map(r => ({ reason: r.reason, evidence: r.evidence.map(thinSpan) }));
          for (const r of residuals) bump(state.parent_residual_reasons, r.reason);
          await part.parents.add({ ...sourcePointer, parent_source_field: result.parent_source_field, parent_field_hash: result.parent_field_hash, source_status: result.source_status, source_type: result.source_type, parent_outcome: result.parent_outcome, is_explicit_bundle: result.is_explicit_bundle, candidate_count: issues.length, identical_blocks_collapsed: result.identical_blocks_collapsed || 0, issues, residuals });
          state.parent_rows++; partParents++;
          bump(state.counts, 'PARENT_' + result.parent_outcome);
          if (!issues.length) sample('PARENT_ONLY|' + (residuals.at(-1)?.reason || 'UNKNOWN'), sourcePointer);
          state.cursor = { selection_index: selectionIndex, row_index: rowIndex };
          if (partParents >= batchSize) await closePart();
        }
      if (perChunk == null && state.parent_rows < maxParents) assert.equal(rowIndex, chunk.rows, 'SOURCE_CHUNK_ROW_COUNT_MISMATCH');
      state.cursor = { selection_index: selectionIndex + 1, row_index: 0 };
      if (state.parent_rows >= maxParents) break;
    }
    await closePart();
    const full = !perChunk && selected.length === manifest.chunks.length && maxParents === manifest.rows;
    if (full) assert.equal(state.parent_rows, manifest.rows, 'FULL_PARENT_POPULATION_MISMATCH');
    state.status = full ? 'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN' : 'PASS_BOUNDED_LOCAL_EXPANDED_CANDIDATE_DRY_RUN';
    state.finished_at = new Date().toISOString();
    state.production_writes = 0; state.source_mutations = 0; state.database_queries = 0;
    state.final_publication_approved = false;
    state.limitations = ['Candidate support is not final SQL materialization/publication or FX/repost/plausibility admission.', 'Every input parent is represented once; candidate counts are source offer blocks, not unique physical watches.', 'Existing revision725 publications and reviewed overlays have not been replaced by this local dry-run.', 'Unknown chronology, offer identity, currency, package scope and quantity remain explicit review or later-stage gates.'];
    await save(progressFile, state);
    await save(path.join(outputDir, 'manifest.json'), state);
    if (config.public_progress_file) {
      const { samples, ...summary } = state;
      await save(path.resolve(config.public_progress_file), { ...summary, private_output_directory: outputDir });
    }
    console.log(JSON.stringify({ status: state.status, parents: state.parent_rows, candidates: state.candidate_rows, counts: state.counts, private_manifest: path.join(outputDir, 'manifest.json') }));
    return state;
  } catch (error) {
    if (part) { part.candidates.abort(); part.parents.abort(); }
    const durable = fs.existsSync(progressFile) ? read(progressFile) : null;
    const failure = { status: 'STOPPED_WITH_DURABLE_LOCAL_CHECKPOINT', error_code: error.code || error.name, error_message: error.message, completed_parents: durable?.parent_rows || 0, failed_attempt_parents: state.parent_rows, at: new Date().toISOString(), binding };
    await save(path.join(outputDir, 'failure-' + Date.now() + '.json'), failure);
    console.error(JSON.stringify(failure));
    throw error;
  }
}

if (require.main === module) {
  const configFile = process.argv[2];
  if (!configFile) throw new Error('LOCAL_CONFIG_FILE_REQUIRED');
  run(read(configFile)).catch(() => { process.exitCode = 1; });
}
module.exports = { run, jsonLines };
