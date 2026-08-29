'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { GIB, auditDiskCapacity, sanitizeDiskAudit } = require('../tools/supabase/audit-disk-capacity.cjs');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('disk audit sanitizes management responses and evaluates filesystem headroom', () => {
  const audit = sanitizeDiskAudit('qnsafosakvonzgfcsphh',
    { attributes: { size_gb: 16, type: 'gp3', iops: 3000 }, last_modified_at: '2026-08-13T00:00:00Z' },
    { timestamp: '2026-08-13T01:00:00Z', metrics: { fs_size_bytes: 16 * GIB, fs_used_bytes: 12 * GIB, fs_avail_bytes: 4 * GIB } },
    { growth_percent: 50, min_increment_gb: 8, max_size_gb: 64 }, 2);
  assert.equal(audit.disk.configured_size_gib, 16);
  assert.equal(audit.disk.available_gib, 4);
  assert.equal(audit.disk.utilization_percent, 75);
  assert.equal(audit.gate.headroom_satisfied, true);
  assert.deepEqual(Object.keys(audit.autoscale), ['growth_percent', 'min_increment_gib', 'max_size_gib']);
  assert.equal(JSON.stringify(audit).includes('iops'), false);
});

test('audit makes exactly three GET requests to the pinned disk endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/util')) return { ok: true, status: 200, json: async () => ({ timestamp: '2026-08-13T01:00:00Z', metrics: { fs_size_bytes: 8 * GIB, fs_used_bytes: 6 * GIB, fs_avail_bytes: 2 * GIB } }) };
    if (url.endsWith('/autoscale')) return { ok: true, status: 200, json: async () => ({ growth_percent: 50, min_increment_gb: 8, max_size_gb: 64 }) };
    return { ok: true, status: 200, json: async () => ({ attributes: { size_gb: 8, type: 'gp3' } }) };
  };
  const audit = await auditDiskCapacity({ env: {
    SUPABASE_ACCESS_TOKEN: 'secret-not-returned', SUPABASE_PROJECT_REF: 'qnsafosakvonzgfcsphh',
    EXPECTED_PROJECT_REF: 'qnsafosakvonzgfcsphh', MINIMUM_HEADROOM_GIB: '1',
  }, fetchImpl });
  assert.equal(audit.gate.headroom_satisfied, true);
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'GET', 'GET']);
  assert.deepEqual(calls.map(call => call.url), [
    'https://api.supabase.com/v1/projects/qnsafosakvonzgfcsphh/config/disk',
    'https://api.supabase.com/v1/projects/qnsafosakvonzgfcsphh/config/disk/util',
    'https://api.supabase.com/v1/projects/qnsafosakvonzgfcsphh/config/disk/autoscale',
  ]);
  assert.equal(JSON.stringify(audit).includes('secret-not-returned'), false);
});

test('workflow is pinned and cannot resize or mutate disk configuration', () => {
  const workflow = read('.github/workflows/qnsa-disk-capacity-audit.yml');
  const script = read('tools/supabase/audit-disk-capacity.cjs');
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /AUDIT_QNSA_DISK_READ_ONLY/);
  assert.match(script, /method: 'GET'/);
  assert.doesNotMatch(`${workflow}\n${script}`, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(workflow, /config\/disk[^\n]*--request\s+(?:POST|PUT|PATCH|DELETE)/i);
});

test('disk audit fails closed for insufficient headroom and inconsistent metrics', () => {
  const audit = sanitizeDiskAudit('qnsafosakvonzgfcsphh',
    { attributes: { size_gb: 8 } },
    { metrics: { fs_size_bytes: 8 * GIB, fs_used_bytes: 7.9 * GIB, fs_avail_bytes: 0.1 * GIB } },
    {}, 0.25);
  assert.equal(audit.gate.headroom_satisfied, false);
  assert.throws(() => sanitizeDiskAudit('qnsafosakvonzgfcsphh',
    { attributes: { size_gb: 8 } },
    { metrics: { fs_size_bytes: 8 * GIB, fs_used_bytes: 9 * GIB, fs_avail_bytes: 0 } }, {}, 1),
  /Inconsistent Supabase disk metrics/);
});
