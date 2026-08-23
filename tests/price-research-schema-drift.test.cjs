'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');

test('Price Research never requires optional legacy watch_records columns', () => {
  assert.match(source, /const watchRecordColumns = columns\.split\(','\)[\s\S]*\['model', 'listing_date', 'listing_status'\]\.includes\(column\)/);
  assert.match(source, /select\(table === 'watch_records' \? watchRecordColumns : columns\)/);
});

test('verified WTB identity loading also uses the proven legacy watch_records projection', () => {
  const demandProjection = source.match(/const columns = 'id,brand,reference,dial_color,condition,listing_type[^']+'/)?.[0] || '';
  assert.ok(demandProjection);
  assert.doesNotMatch(demandProjection, /(?:^|,)model(?:,|$)/);
  assert.doesNotMatch(demandProjection, /(?:^|,)listing_date(?:,|$)/);
  assert.doesNotMatch(demandProjection, /(?:^|,)listing_status(?:,|$)/);
});

test('exact catalog references keep a valid empty verified cohort instead of querying the obsolete raw table', () => {
  assert.match(source, /!configuredSourceTable && !exactKnownReference[\s\S]*result\.error \|\| !\(result\.data \|\| \[\]\)\.length/);
});
