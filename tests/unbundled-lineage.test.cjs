'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reconcileLineage } = require('../tools/multilisting/reconcile-unbundled-lineage.cjs');

test('reconciles stable child keys and exact raw parent lineage', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundle-lineage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const listingsPath = path.join(directory, 'listings.csv');
  const parentsPath = path.join(directory, 'parents.csv');
  const mappingPath = path.join(directory, 'mapping.csv');
  fs.writeFileSync(listingsPath, [
    'listing_id,source_record_id,candidate_index,raw_line,listing_type,source_created_at',
    'source-1_000,source-1,0,126500LN White HKD 283000,WTS,2026-07-01T00:00:00Z',
  ].join('\n'));
  fs.writeFileSync(parentsPath, [
    'source_record_id,raw_message,listing_type,created_at,seller_name,seller_phone,dealer',
    'source-1,126500LN White HKD 283000,WTS,2026-07-01T00:00:00Z,,,',
  ].join('\n'));
  fs.writeFileSync(mappingPath, [
    'source_record_id,candidate_index,listing_id',
    'source-1,0,source-1_000',
  ].join('\n'));

  const report = await reconcileLineage({ listingsPath, parentsPath, mappingPath });
  assert.equal(report.goNoGo.decision, 'LINEAGE_GATE_PASSED');
  assert.equal(report.rates.parentJoin, 1);
  assert.equal(report.rates.exactRawLineage, 1);
  assert.equal(report.rates.mappingJoin, 1);
});
