'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');

test('Price Research never requires the optional watch_records model column', () => {
  assert.match(source, /const watchRecordColumns = columns\.split\(','\)\.filter\(column => column !== 'model'\)\.join\(','\)/);
  assert.match(source, /select\(table === 'watch_records' \? watchRecordColumns : columns\)/);
});

test('verified WTB identity loading also uses the proven legacy watch_records projection', () => {
  const demandProjection = source.match(/const columns = 'id,brand,reference,dial_color,condition,listing_type[^']+'/)?.[0] || '';
  assert.ok(demandProjection);
  assert.doesNotMatch(demandProjection, /(?:^|,)model(?:,|$)/);
});
