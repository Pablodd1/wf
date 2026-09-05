'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('price review rejection is audited and cannot mutate watch_records', () => {
  const sql = read('supabase/migrations/20260722093000_reject_price_review.sql');
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /INSERT INTO public\.normalization_review_decisions/);
  assert.match(sql, /review_status = 'REJECTED'/);
  assert.doesNotMatch(sql, /UPDATE public\.watch_records/i);
});

test('price review API requires an authenticated reviewer and routes decisions through audited RPCs', () => {
  const queue = read('api/price-remediation-review.js');
  const decision = read('api/price-remediation-review-decision.js');
  assert.match(queue, /authorizeDealer\(req, res, new Set\(\['reviewer', 'admin'\]\)\)/);
  assert.match(queue, /price_remediation_review/);
  assert.match(queue, /raw_message/);
  assert.match(decision, /apply_price_review_decision/);
  assert.match(decision, /reject_price_review_decision/);
  assert.match(decision, /A review reason is required/);
});
