const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20260815163000_qnsa_dealer_linkage_uuid_cursor_fix.sql'), 'utf8');

test('dealer linkage UUID cursor repair is idempotent and storage neutral', () => {
  assert.match(sql, /pg_get_functiondef/i);
  assert.match(sql, /max\(id::text\)::uuid/i);
  assert.match(sql, /cursor expression does not match audited contract/i);
  assert.doesNotMatch(sql, /insert\s+into|update\s+staging|delete\s+from|truncate/i);
});
