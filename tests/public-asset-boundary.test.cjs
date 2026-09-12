'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preparePublicAssets } = require('../tools/prepare-public-assets.cjs');

test('static build cannot copy raw exports, contacts, workbooks or stale generated files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-public-boundary-'));
  const publicDir = path.join(root, 'public'); fs.mkdirSync(publicDir);
  fs.mkdirSync(path.join(root, '.safe-public'));
  fs.writeFileSync(path.join(root, '.safe-public', 'stale-private.json'), '{"phone":"synthetic-private"}');
  fs.writeFileSync(path.join(publicDir, 'enriched_refs.json'), '{"sampledListings":[{"phone":"synthetic-private"}]}');
  fs.writeFileSync(path.join(publicDir, 'catalog-identities.json'), '[{"brand":"Fixture Brand","reference":"SYN-1","phone":"synthetic-private","avg":123}]');
  for (const name of ['private.xlsx', 'live_stream.json', 'top_watches_trading_floor.json']) {
    fs.writeFileSync(path.join(publicDir, name), 'synthetic-private');
  }
  const output = preparePublicAssets(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'enriched_refs.json'))), [{brand:'Fixture Brand',reference:'SYN-1'}]);
  for (const file of fs.readdirSync(output)) assert.ok(!fs.readFileSync(path.join(output,file),'utf8').includes('synthetic-private'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'parsedWatches.json'))),[]);
  assert.ok(!fs.existsSync(path.join(output,'stale-private.json')));
  // Test-created temporary directory only, verified before recursive cleanup.
  assert.equal(path.dirname(root),os.tmpdir()); assert.ok(path.basename(root).startsWith('wf-public-boundary-'));
  fs.rmSync(root,{recursive:true,force:true});
});
