'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('full correction cursor revisits only missing or incomplete USD evidence', () => {
  const sql = fs.readFileSync(path.join(__dirname,
    '../supabase/migrations/20260812123000_two_brand_missing_price_cursor.sql'), 'utf8');
  const missingUsd = /COALESCE\(listing\.price_usd, 0\) <= 0/g;
  const incompleteFx = /listing\.conversion_timestamp IS NULL/g;
  assert.ok((sql.match(missingUsd) || []).length >= 3,
    'page, reconciliation and continuation paths must share the missing-USD gate');
  assert.ok((sql.match(incompleteFx) || []).length >= 3,
    'all cursor paths must revisit incomplete non-USD FX evidence');
  const lineageGate = /EXISTS \(\s*SELECT 1 FROM public\.raw_message_versions AS version/g;
  assert.ok((sql.match(lineageGate) || []).length >= 2,
    'both the page membership and continuation paths require immutable lineage');
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:public\.)?watch_records/i);
});


