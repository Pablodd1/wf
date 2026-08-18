'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dealer activity RPC is bounded, exact-ID, bundle-safe, and service-role only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260812113000_qnsa_legacy_dealer_activity_rpc.sql'), 'utf8');
  assert.match(sql, /l\.company_id = p_legacy_profile_id/);
  assert.match(sql, /l\.parent_id IS NULL/);
  assert.match(sql, /l\.is_bundle = false/);
  assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)/);
  assert.match(sql, /GRANT EXECUTE[^;]+service_role/is);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]+anon/is);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE staging|DELETE FROM/i);
});

test('apply workflow is pinned to QNSA production and requires explicit confirmation', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-legacy-dealer-activity-rpc.yml'), 'utf8');
  assert.match(yaml, /APPLY_QNSA_LEGACY_DEALER_ACTIVITY_RPC/);
  assert.match(yaml, /environment: production/);
  assert.match(yaml, /qnsafosakvonzgfcsphh/);
  assert.match(yaml, /Expected 21 stable profile audit results/);
});
