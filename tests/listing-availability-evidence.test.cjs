'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const ts = require('typescript');
const filename = require.resolve('../src/lib/customerEvidence.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exportsObject = {};
new Function('require', 'exports', output)(createRequire(filename), exportsObject);
test('unknown, partial, or latest-observation evidence never claims confirmed current availability', () => {
  for (const row of [{}, { cohort_status: 'CONFIRMED_CURRENT' }, { current_status: 'CURRENT_ACTIVE' },
    { cohort_status: 'LATEST_OBSERVED', current_status: 'CURRENT_LATEST_STATE' }]) {
    assert.equal(exportsObject.listingAvailabilityLabel(row), 'OBSERVED · CHECK AVAILABILITY');
  }
  assert.equal(exportsObject.listingAvailabilityLabel({ cohort_status: 'CONFIRMED_CURRENT', current_status: 'CURRENT_ACTIVE' }), 'CONFIRMED CURRENT');
});

test('source history is explicit and never relabelled as confirmed availability', () => {
  const current = { cohort_status: 'CONFIRMED_CURRENT', current_status: 'CURRENT_ACTIVE' };
  assert.equal(exportsObject.listingAvailabilityLabel({ ...current, source_listing_status: 'ended' }), 'HISTORICAL · SOURCE ENDED');
  assert.equal(exportsObject.listingAvailabilityLabel({ ...current, source_listing_status: 'open', source_deleted: true }), 'HISTORICAL · SOURCE MARKED DELETED');
  assert.equal(exportsObject.listingAvailabilityLabel({ source_listing_status: 'open' }), 'SOURCE MARKED OPEN · CHECK AVAILABILITY');
  assert.equal(exportsObject.listingAvailabilityLabel({ source_listing_status: 'reserved' }), 'SOURCE STATUS: reserved · CHECK AVAILABILITY');
  assert.equal(exportsObject.listingAvailabilityLabel({ source_deleted: false }), 'OBSERVED · CHECK AVAILABILITY');
});
