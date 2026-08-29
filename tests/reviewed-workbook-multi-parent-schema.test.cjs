'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20260817013000_reviewed_workbook_multi_parent_type.sql',
), 'utf8');
const analytics = fs.readFileSync(path.join(
  __dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs',
), 'utf8');
const browse = fs.readFileSync(path.join(
  __dirname, '..', 'api', '_lib', 'reviewed-workbook-browse.cjs',
), 'utf8');

test('forward migration adds MULTI without mutating inventory', () => {
  assert.match(migration, /listing_type IN \('WTS', 'WTB', 'OTHER', 'MULTI'\)/);
  assert.match(migration, /VALIDATE CONSTRAINT reviewed_workbook_inventory_listing_type_check/);
  const sql = migration.replace(/^--.*$/gm, '');
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test('Price Research remains exact single WTS only', () => {
  assert.match(analytics, /\.eq\('verification_status', 'APPROVED_SINGLE_CANDIDATE'\)/);
  assert.match(analytics, /\.eq\('price_evidence_status', 'SOURCE_EXPLICIT_USD_MATCH'\)/);
  assert.match(analytics, /\.eq\('listing_type', 'WTS'\)/);
  assert.match(browse, /\.eq\('verification_status', 'APPROVED_SINGLE_CANDIDATE'\)/);
  assert.match(browse, /\.in\('listing_type', \['WTS', 'WTB'\]\)/);
  assert.doesNotMatch(analytics, /APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY/);
});
