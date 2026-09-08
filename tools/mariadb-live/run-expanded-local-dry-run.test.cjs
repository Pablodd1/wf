'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { run, jsonLines } = require('./run-expanded-local-dry-run.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('LF-only archive framing, durable interrupted resume and complete parent/candidate parity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-expanded-local-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'wf-expanded-local-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const originals = [];
  const chunks = [];
  for (let chunk = 0; chunk < 2; chunk++) {
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const raw = { id: `fixture-${chunk}-${i}`, title: i % 2 ? 'Rolex\u2028WTS\u2028116500LN asking USD 25000\u2028126610LN asking USD 14000' : '😀 WTB Rolex 116500LN', description: null, is_bundle: i % 2, type: null, brand: null };
      const line = stableJson(raw); originals.push(line); rows.push(line);
    }
    const bytes = zlib.gzipSync(rows.join('\n') + '\n');
    const name = `${chunk}.jsonl.gz`; fs.writeFileSync(path.join(root, name), bytes);
    chunks.push({ file: name, sha256: sha(bytes), rows: rows.length });
  }
  const source = path.join(root, 'source-manifest.json');
  fs.writeFileSync(source, JSON.stringify({ source_system: 'fixture', source_database: 'fixture', source_table: 'auctions', manifest_sha256: sha(originals.join('\n')), chunks, rows: 8 }));
  const reconstructed = [];
  for (const c of chunks) for await (const line of jsonLines(path.join(root, c.file))) reconstructed.push(line);
  assert.deepEqual(reconstructed, originals);
  const config = { source_manifest: source, output_directory: path.join(root, 'resumed'), minimum_free_bytes: 0, batch_parents: 2 };
  await assert.rejects(run(config, { interruptAfterParts: 1 }), /TEST_CHECKPOINT_INTERRUPT/);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(config.output_directory, 'checkpoint.json')));
  assert.equal(checkpoint.parent_rows, 2);
  const resumed = await run(config);
  const complete = await run({ ...config, output_directory: path.join(root, 'uninterrupted') });
  assert.equal(resumed.status, 'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN');
  assert.equal(resumed.parent_rows, 8); assert.equal(resumed.candidate_rows, 12);
  assert.deepEqual(resumed.counts, complete.counts);
  const records = (result, key) => result.parts.flatMap(p => zlib.gunzipSync(fs.readFileSync(p[key].file)).toString('utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse));
  assert.deepEqual(records(resumed, 'candidates'), records(complete, 'candidates'));
  assert.deepEqual(records(resumed, 'parents'), records(complete, 'parents'));
  assert.equal(new Set(records(resumed, 'parents').map(r => r.source_id)).size, 8);
  assert.equal(new Set(records(resumed, 'candidates').map(r => r.candidate_hash)).size, 12);
  assert.deepEqual(chunks.map(c => sha(fs.readFileSync(path.join(root, c.file)))), chunks.map(c => c.sha256));
  await assert.rejects(run({ ...config, batch_parents: 3 }), /RESUME_INPUT_OR_CODE_CHANGED/);
});
