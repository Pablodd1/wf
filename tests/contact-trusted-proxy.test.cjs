'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const supabasePath = require.resolve('../api/_lib/supabase.js');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true,
  exports: { getClient() { throw new Error('No database access permitted in this test'); } } };
const { contactRequestKey, contactRateLimited, resetContactRateLimitForTests } = require('../api/listing-contact.js');
const req = (ip = '192.0.2.1', forwarded = '198.51.100.1') => ({
  socket: { remoteAddress: ip }, headers: { 'x-forwarded-for': forwarded, 'x-real-ip': forwarded },
});
test.beforeEach((t) => {
  const env = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  resetContactRateLimitForTests();
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
test('100 spoofed forwarded addresses on one direct socket exhaust one bucket', () => {
  let refused = 0;
  for (let i = 0; i < 100; i++) {
    if (contactRateLimited(req('192.0.2.1', `198.51.100.${i}`), 1000)) refused++;
  }
  assert.equal(refused, 70);
});
test('request headers cannot impersonate the Vercel runtime', () => {
  const request = req();
  request.headers.vercel = '1';
  request.headers['x-vercel-id'] = 'fake';
  assert.equal(contactRequestKey(request), '192.0.2.1');
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'development';
  assert.equal(contactRequestKey(request), '192.0.2.1');
});
test('verified Vercel runtime accepts only a single valid edge IP', () => {
  process.env.VERCEL = '1'; process.env.VERCEL_ENV = 'preview';
  assert.equal(contactRequestKey(req()), '198.51.100.1');
  for (const header of ['198.51.100.1, 198.51.100.2', 'bad', ['198.51.100.1']]) {
    assert.equal(contactRequestKey(req('192.0.2.1', header)), '192.0.2.1');
  }
});
test('IPv6 aliases and mapped IPv4 cannot multiply buckets', () => {
  assert.equal(contactRequestKey(req('::ffff:192.0.2.1')), '192.0.2.1');
  assert.equal(contactRequestKey(req('::ffff:c000:201')), '192.0.2.1');
  assert.equal(contactRequestKey(req('2001:db8::1')), contactRequestKey(req('2001:0db8:0:0:0:0:0:1')));
});
test('unknown peers share a bounded identity and window expiration resets quota', () => {
  for (let i = 0; i < 30; i++) assert.equal(contactRateLimited({ headers: req().headers }, 1000), false);
  assert.equal(contactRateLimited({}, 1000), true);
  assert.equal(contactRateLimited({}, 601000), false);
});
test('capacity fails closed without evicting active counters; expired entries are reclaimed', () => {
  for (let i = 0; i < 10000; i++) {
    assert.equal(contactRateLimited(req(`2001:db8::${(i + 1).toString(16)}`), 1000), false);
  }
  assert.equal(contactRateLimited(req('192.0.2.2'), 1000), true);
  assert.equal(contactRateLimited(req('192.0.2.2'), 601000), false);
});
