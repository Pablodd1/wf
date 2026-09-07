'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const ENV_KEYS = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'USE_DIRECT_POSTGREST'];

test('missing server configuration produces a redacted 503 on both canary surfaces', async (t) => {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  ENV_KEYS.forEach(k => delete process.env[k]);
  t.after(() => ENV_KEYS.forEach(k => saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]));
  for (const file of ['trading-floor', 'price-research']) {
    const handler = require(`../api/canary/${file}.js`);
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query: { reference: '124060' } }, res);
    assert.equal(res.code, 503);
    assert.match(JSON.stringify(res.body), /Service temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(res.body), /SUPABASE|stack|key/i);
  }
});

test('custom Supabase domains preserve the gateway path; direct PostgREST requires an explicit flag', async (t) => {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; ENV_KEYS.forEach(k => saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]); });
  process.env.SUPABASE_URL = 'https://database.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-fixture';
  delete process.env.USE_DIRECT_POSTGREST;
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return new Response('[]', { headers: { 'content-type': 'application/json' } }); };
  const { getClient } = require('../api/_lib/supabase.js');
  await getClient().rpc('fixture');
  assert.equal(urls.pop(), 'https://database.example.test/rest/v1/rpc/fixture');
  process.env.USE_DIRECT_POSTGREST = 'true';
  await getClient().rpc('fixture');
  assert.equal(urls.pop(), 'https://database.example.test/rpc/fixture');
});

test('disposable build guard still refuses a production target', () => {
  const run = spawnSync(process.execPath, [path.resolve('tools/verify-no-production-references.cjs')], {
    env: { ...process.env, SUPABASE_URL: 'https://bptrvfncppbjnchsaxtb.supabase.co' }, encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /CRITICAL SAFETY ERROR/);
});
