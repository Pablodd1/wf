'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('customer navigation and routing do not expose Source Review', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'src', 'components', 'MarketHeader.tsx'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

  assert.doesNotMatch(app, /ReviewedWorkbookInventory|\/source-review/);
  assert.doesNotMatch(header, /SOURCE REVIEW|\/source-review/);
  assert.doesNotMatch(main, /\/source-review/);
});

test('reviewed workbook evidence API is reviewer-only and private', () => {
  const source = fs.readFileSync(path.join(root, 'api', 'reviewed-workbook-inventory.js'), 'utf8');

  assert.match(source, /authorizeDealer\(req, res, new Set\(\['reviewer', 'admin'\]\)\)/);
  assert.match(source, /Cache-Control', 'private, no-store'/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
});
