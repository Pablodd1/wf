const { test } = require('node:test');
const assert = require('node:assert/strict');

// Import the handler
const feedbackHandler = require('../api/feedback.js');

function createMockReqRes({ method = 'POST', headers = {}, body = {}, ip = '198.51.100.1' } = {}) {
  const req = {
    method,
    headers: {
      origin: 'https://curatedluxury.space',
      'x-forwarded-for': ip,
      ...headers,
    },
    body,
  };

  let statusCode = 200;
  let responseData = null;
  const setHeaders = {};

  const res = {
    setHeader(name, value) {
      setHeaders[name.toLowerCase()] = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end() {
      return this;
    },
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
    getSetHeaders: () => setHeaders,
  };

  return { req, res };
}

test('feedback endpoint rejects non-POST non-OPTIONS methods', async () => {
  const { req, res } = createMockReqRes({ method: 'GET' });
  await feedbackHandler(req, res);
  assert.equal(res.getStatusCode(), 405);
  assert.match(res.getResponseData().error, /method not allowed/i);
});

test('feedback endpoint validates and rejects unauthorized origins', async () => {
  const { req, res } = createMockReqRes({
    headers: { origin: 'https://malicious-attacker-site.com' },
  });
  await feedbackHandler(req, res);
  assert.equal(res.getStatusCode(), 403);
  assert.match(res.getResponseData().error, /unauthorized origin/i);
});

test('feedback endpoint catches honeypot bot submissions without relaying', async () => {
  const { req, res } = createMockReqRes({
    body: {
      reference: '116500LN',
      listing: { title: 'Rolex Daytona' },
      client_challenge: 'bot-fill-value', // Honeypot filled
      type: 'telegram',
    },
  });
  await feedbackHandler(req, res);
  assert.equal(res.getStatusCode(), 400);
  assert.match(res.getResponseData().error, /validation challenge failed/i);
});

test('feedback endpoint rejects invalid or malicious reference formatting', async () => {
  const { req, res } = createMockReqRes({
    body: {
      reference: '<script>alert(1)</script>',
      listing: { title: 'Rolex Daytona' },
      type: 'telegram',
    },
  });
  await feedbackHandler(req, res);
  assert.equal(res.getStatusCode(), 400);
  assert.match(res.getResponseData().error, /invalid reference format/i);
});

test('feedback endpoint enforces IP-based rate limiting on repeated requests', async () => {
  const testIp = '203.0.113.99';
  const validBody = {
    reference: '126610LN',
    listing: { title: 'Rolex Submariner', price: 13500, currency: 'USD' },
    type: 'telegram',
  };

  // Perform 3 calls (allowed under rate limit)
  for (let i = 0; i < 3; i++) {
    const { req, res } = createMockReqRes({ ip: testIp, body: validBody });
    await feedbackHandler(req, res);
    assert.notEqual(res.getStatusCode(), 429, `Call ${i + 1} should not be rate limited`);
  }

  // 4th call from same IP should be blocked by rate limit
  const { req, res } = createMockReqRes({ ip: testIp, body: validBody });
  await feedbackHandler(req, res);
  assert.equal(res.getStatusCode(), 429);
  assert.match(res.getResponseData().error, /rate limit exceeded/i);
});
