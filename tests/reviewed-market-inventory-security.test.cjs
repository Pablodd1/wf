'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const handler = require('../api/reviewed-market-inventory.js');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

async function withEnvAsync(tempEnv, fn) {
  const keys = [
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'VERCEL_ENV',
    'MARKET_SOURCE_VIEW',
  ];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(tempEnv)) {
    if (v !== undefined) {
      process.env[k] = v;
    }
  }

  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] !== undefined) {
        process.env[k] = saved[k];
      } else {
        delete process.env[k];
      }
    }
  }
}

test('no JWT literal exists in application source', () => {
  const apiDir = path.join(root, 'api');
  const files = fs.readdirSync(apiDir, { recursive: true })
    .filter(f => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.cjs')));

  const jwtLiteralRegex = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

  for (const file of files) {
    const fullPath = path.join(apiDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const matches = content.match(jwtLiteralRegex);
    assert.equal(
      matches,
      null,
      `Found forbidden hardcoded JWT literal in application source file: ${file}`,
    );
  }
});

test('missing all four Supabase key variables returns HTTP 503 and performs zero outbound fetches', async () => {
  await withEnvAsync({
    SUPABASE_URL: 'https://test-example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_SECRET_KEY: undefined,
    SUPABASE_ANON_KEY: undefined,
    VITE_SUPABASE_ANON_KEY: undefined,
  }, async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('Outbound fetch must not be called when configuration is missing');
    };

    try {
      const res = responseCapture();
      await handler({ method: 'GET', query: {} }, res);

      assert.equal(res.statusCode, 503);
      assert.equal(res.body?.status, 'error');
      assert.equal(fetchCalled, false, 'Expected no outbound fetch to occur when keys are missing');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('missing both SUPABASE_URL and all four Supabase key variables returns HTTP 503 without outbound fetch', async () => {
  await withEnvAsync({
    SUPABASE_URL: undefined,
    VITE_SUPABASE_URL: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_SECRET_KEY: undefined,
    SUPABASE_ANON_KEY: undefined,
    VITE_SUPABASE_ANON_KEY: undefined,
  }, async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('Outbound fetch must not be called when configuration is missing');
    };

    try {
      const res = responseCapture();
      await handler({ method: 'GET', query: {} }, res);

      assert.equal(res.statusCode, 503);
      assert.equal(res.body?.status, 'error');
      assert.equal(fetchCalled, false, 'Expected no outbound fetch to occur when keys and URL are missing');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('explicitly supplied test anon key follows the normal bounded path and does not leak in responses or logs', async () => {
  const secretKeyCandidate = 'test-secret-anon-key-alpha-998877';

  await withEnvAsync({
    SUPABASE_URL: 'https://test-example.supabase.co',
    SUPABASE_ANON_KEY: secretKeyCandidate,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_SECRET_KEY: undefined,
    VITE_SUPABASE_ANON_KEY: undefined,
  }, async () => {
    const fetchCalls = [];
    const loggedLines = [];

    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    console.log = (...args) => loggedLines.push(args.join(' '));
    console.warn = (...args) => loggedLines.push(args.join(' '));
    console.error = (...args) => loggedLines.push(args.join(' '));

    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const res = responseCapture();
      await handler({ method: 'GET', query: { brand: 'Omega', pageSize: 12 } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(fetchCalls.length > 0, true, 'Expected outbound fetch to be initiated along normal path');

      // Verify outbound request included the supplied key in headers
      const firstCall = fetchCalls[0];
      assert.equal(getHeader(firstCall.opts.headers, 'apikey'), secretKeyCandidate);
      assert.equal(getHeader(firstCall.opts.headers, 'authorization'), `Bearer ${secretKeyCandidate}`);

      // Verify response body does NOT leak the secret key
      const bodyText = JSON.stringify(res.body);
      assert.equal(
        bodyText.includes(secretKeyCandidate),
        false,
        'Secret key must not appear anywhere in the response body',
      );

      // Verify console logs do NOT leak the secret key
      const allLogs = loggedLines.join('\n');
      assert.equal(
        allLogs.includes(secretKeyCandidate),
        false,
        'Secret key must not appear anywhere in logs',
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
    }
  });
});

test('each of the four accepted Supabase key environment variables is accepted individually', async () => {
  const keyVars = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ];

  for (const targetKeyVar of keyVars) {
    const secretValue = `test-secret-token-for-${targetKeyVar}`;
    const envConfig = {
      SUPABASE_URL: 'https://test-example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_ANON_KEY: undefined,
      VITE_SUPABASE_ANON_KEY: undefined,
    };
    envConfig[targetKeyVar] = secretValue;

    await withEnvAsync(envConfig, async () => {
      const fetchCalls = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        fetchCalls.push({ url: String(url), opts });
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      try {
        const res = responseCapture();
        await handler({ method: 'GET', query: { brand: 'Omega', pageSize: 12 } }, res);

        assert.equal(res.statusCode, 200, `Expected 200 OK when using ${targetKeyVar}`);
        assert.equal(fetchCalls.length > 0, true, `Expected fetch calls when using ${targetKeyVar}`);
        assert.equal(getHeader(fetchCalls[0].opts.headers, 'apikey'), secretValue);
        assert.equal(getHeader(fetchCalls[0].opts.headers, 'authorization'), `Bearer ${secretValue}`);

        // Verify secret not in response
        const bodyText = JSON.stringify(res.body);
        assert.equal(bodyText.includes(secretValue), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

