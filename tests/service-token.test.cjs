'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requireServiceToken, tokensMatch } = require('../api/_lib/require-service-token.cjs');

function response() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('compares tokens without accepting prefixes or missing values', () => {
  assert.equal(tokensMatch('secret', 'secret'), true);
  assert.equal(tokensMatch('secret-extra', 'secret'), false);
  assert.equal(tokensMatch('', 'secret'), false);
});

test('rejects requests when service authentication is not configured', () => {
  const previous = process.env.INGEST_API_TOKEN;
  delete process.env.INGEST_API_TOKEN;
  const res = response();
  assert.equal(requireServiceToken({ headers: {} }, res), false);
  assert.equal(res.code, 503);
  if (previous === undefined) delete process.env.INGEST_API_TOKEN;
  else process.env.INGEST_API_TOKEN = previous;
});

test('accepts only the configured bearer token', () => {
  const previous = process.env.INGEST_API_TOKEN;
  process.env.INGEST_API_TOKEN = 'expected-token';
  const denied = response();
  assert.equal(requireServiceToken({ headers: { authorization: 'Bearer wrong' } }, denied), false);
  assert.equal(denied.code, 401);
  assert.equal(requireServiceToken({ headers: { authorization: 'Bearer expected-token' } }, response()), true);
  if (previous === undefined) delete process.env.INGEST_API_TOKEN;
  else process.env.INGEST_API_TOKEN = previous;
});
