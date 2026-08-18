'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { classify, run } = require('../tools/mariadb-live/audit-non-watch.cjs');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function source(id, title, extra = {}) {
  return sourceRecord({ id, created_on: `2026-08-01 00:00:0${id}`, title, ...extra });
}

test('non-watch audit uses explicit source evidence and defers ambiguous bracelet language', () => {
  assert.equal(classify(source('1', 'Hermes Birkin 30 handbag')).category, 'HANDBAG');
  assert.equal(classify(source('2', 'Diamond necklace with matching earrings')).category, 'JEWELRY');
  assert.equal(classify(source('3', 'Louis Vuitton wallet and card holder')).category, 'ACCESSORY');
  assert.equal(classify(source('4', 'Rolex 116500LN watch')).category, 'WATCH');
  assert.equal(classify(source('5', 'Rolex watch with extra bracelet')).category, 'WATCH');
  assert.equal(classify(source('6', 'Gold bracelet')).category, 'AMBIGUOUS');
  assert.equal(classify(source('7', 'Luxury item available')).category, 'UNCLASSIFIED');
  assert.equal(classify(source('8', 'Jacob & Co Casino watch Diamonds full set')).category, 'WATCH');
  assert.equal(classify(source('9', 'Two luxury purses available')).category, 'HANDBAG');
  assert.equal(classify(source('10', 'Pair of diamond brooches')).category, 'JEWELRY');
  assert.equal(classify(source('11', 'Leather card holders')).category, 'ACCESSORY');
  assert.equal(classify(source('12', 'Cartier diamond necklace')).category, 'JEWELRY');
  assert.equal(classify(source('13', 'Chopard engagement ring')).category, 'JEWELRY');
});

test('non-watch audit reconciles every immutable source row and writes no publication data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-non-watch-'));
  try {
    const input = path.join(root, 'raw.jsonl');
    fs.writeFileSync(input, [
      source('1', 'Hermes Birkin 30 handbag'),
      source('2', 'Diamond necklace'),
      source('3', 'Rolex 116500LN watch'),
      source('4', 'Luxury item available'),
    ].map(record => `${JSON.stringify(record)}\n`).join(''));
    const report = await run({
      MARIADB_NON_WATCH_AUDIT_INPUT: input,
      MARIADB_NON_WATCH_AUDIT_OUTPUT: path.join(root, 'output'),
      MARIADB_NON_WATCH_SAMPLE_LIMIT: '2',
    });
    assert.equal(report.input_rows, 4);
    assert.equal(report.counts.HANDBAG, 1);
    assert.equal(report.counts.JEWELRY, 1);
    assert.equal(report.counts.WATCH, 1);
    assert.equal(report.counts.UNCLASSIFIED, 1);
    assert.equal(report.reconciled, true);
    assert.equal(report.publication_writes, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
