'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validatePartition } = require('../tools/multilisting/validate-export.cjs');

function row(id, candidateCount = 1) {
  return {
    source_record_id: id,
    candidate_count: candidateCount,
    source: { id },
    review_policy: {
      parent_immutable: true,
      split_children_before_duplicate_review: true,
      suppress_parent_only_after_approval: true,
    },
  };
}

function fixture(rows) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchfacts-multilisting-'));
  fs.writeFileSync(path.join(outputDir, 'multilistings.jsonl'), `${rows.map(item => JSON.stringify(item)).join('\n')}\n`);
  fs.writeFileSync(path.join(outputDir, 'checkpoint.json'), `${JSON.stringify({
    startAfterId: 'source-0',
    stopBeforeId: 'source-z',
    lastId: rows.at(-1).source_record_id,
    exported: rows.length,
    missingSourceRows: 0,
    completed: true,
  })}\n`);
  return outputDir;
}

test('validates a complete ordered export and totals candidate children', async t => {
  const first = row('source-1', 2);
  first.source.raw_message = 'first line\u2028second visual line';
  const outputDir = fixture([first, row('source-2', 3)]);
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  fs.writeFileSync(checkpointPath, `${JSON.stringify({ ...checkpoint, clientFilter: true, lastId: 'source-y' })}\n`);

  const result = await validatePartition(outputDir);
  assert.equal(result.rows, 2);
  assert.equal(result.candidates, 5);
  assert.equal(result.missingSources, 0);
});

test('rejects duplicate or out-of-order source IDs', async t => {
  const outputDir = fixture([row('source-2'), row('source-2')]);
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  await assert.rejects(validatePartition(outputDir), /not strictly increasing/);
});
