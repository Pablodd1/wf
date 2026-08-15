'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows',
  'qnsa-first-three-eligibility-audit.yml'), 'utf8');

test('first-three diagnostic is bounded, read-only, sanitized, and QNSA-pinned', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /candidate_position <= 2500/);
  assert.match(workflow, /read_only = \$true/);
  assert.match(workflow, /GROUP BY brand_normalized/);
  assert.doesNotMatch(workflow, /raw_message['"]?\s*[,)]|seller_phone|contact_number|from_number/i);
  assert.doesNotMatch(workflow, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
});

test('audit reports every release predicate independently and as a conjunction', () => {
  for (const field of [
    'category_ok', 'singleton_ok', 'intent_ok', 'trading_status_ok', 'verdict_ok',
    'duplicate_ok', 'publication_ok', 'lineage_keys_ok', 'lineage_join_ok',
    'reference_ok', 'not_price_token', 'raw_contains_reference',
    'brand_reference_ok', 'all_gates_ok',
  ]) assert.match(workflow, new RegExp(`'${field}'`));
});
