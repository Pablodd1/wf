'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'reviewed-market-inventory.js'),
  'utf8',
);

test('canonical QNSA Rolex and Patek requests bypass the sparse admission-only branch', () => {
  const sourceSelectionStart = source.indexOf('const activeMarketSourceView');
  const sourceSelectionEnd = source.indexOf('const summaryPromise', sourceSelectionStart);
  const sourceSelection = source.slice(sourceSelectionStart, sourceSelectionEnd);
  const admissionStart = source.indexOf('if (brand && REVIEWED_WORKBOOK_ADMISSION_BRANDS.has(brand)');
  const admissionEnd = source.indexOf("const columns = [", admissionStart);
  const admissionBranch = source.slice(admissionStart, admissionEnd);

  assert.ok(admissionStart > 0 && admissionEnd > admissionStart);
  assert.match(sourceSelection, /!isRolexPatekOverlayBrand\(requestedBrand\)/);
  assert.match(admissionBranch, /activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'/);
  assert.match(admissionBranch, /isRolexPatekOverlayBrand\(brand\)/);
  assert.match(admissionBranch, /reviewed_workbook_inventory/);
  assert.match(source.slice(admissionEnd), /reviewedOverlayBrands/);
});
