'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function response() {
  return {
    code: null,
    body: null,
    headers: {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end() { return this; },
  };
}

function withoutAuthEnvironment(run) {
  const names = [
    'INGEST_API_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
  ];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  return Promise.resolve(run()).finally(() => {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  });
}

test('paid and write-capable endpoints fail closed before provider or mutation work', async () => {
  await withoutAuthEnvironment(async () => {
    const cases = [
      ['ai-parse.js', { rawMessage: 'Rolex 116500LN USD 30000' }],
      ['pipeline-parse.js', { text: 'Rolex 116500LN USD 30000' }],
      ['bulk-disambiguate.js', { records: [{ id: '1', reference: '116500' }] }],
      ['batch-image-dial.js', { imageUrl: 'https://example.com/watch.jpg' }],
      ['reprocess.js', { records: [] }],
      ['ingest-catalog.js', { csv: 'reference,brand\n116500LN,Rolex' }],
      ['study-log.js', { entry: { input: 'x', watch: {} } }],
    ];

    for (const [filename, body] of cases) {
      const handler = require(path.join('..', 'api', filename));
      const res = response();
      await handler({ method: 'POST', headers: {}, body, socket: {} }, res);
      assert.equal(res.code, 503, `${filename} must fail closed when authentication is not configured`);
    }
  });
});

test('Telegram rejects an invalid webhook secret and an unauthenticated manual trigger', async () => {
  const priorSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const priorToken = process.env.INGEST_API_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'expected-secret';
  process.env.INGEST_API_TOKEN = 'expected-service-token';
  const modulePath = require.resolve('../api/telegram-bot.js');
  delete require.cache[modulePath];
  const handler = require(modulePath);

  try {
    const webhookResponse = response();
    await handler({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
      body: { message: { chat: { id: '1' }, text: '/stats' } },
    }, webhookResponse);
    assert.equal(webhookResponse.code, 401);

    const triggerResponse = response();
    await handler({ method: 'POST', headers: {}, body: { action: 'alert-owner' } }, triggerResponse);
    assert.equal(triggerResponse.code, 401);
  } finally {
    delete require.cache[modulePath];
    if (priorSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = priorSecret;
    if (priorToken === undefined) delete process.env.INGEST_API_TOKEN;
    else process.env.INGEST_API_TOKEN = priorToken;
  }
});

test('large paid endpoint payloads are explicitly bounded', () => {
  const bulk = fs.readFileSync(path.join(__dirname, '..', 'api', 'bulk-disambiguate.js'), 'utf8');
  const image = fs.readFileSync(path.join(__dirname, '..', 'api', 'batch-image-dial.js'), 'utf8');
  const reprocess = fs.readFileSync(path.join(__dirname, '..', 'api', 'reprocess.js'), 'utf8');
  assert.match(bulk, /MAX_RECORDS = 100/);
  assert.match(image, /imageBase64\.length > 14_000_000/);
  assert.match(reprocess, /records\.length > 500/);
});

test('browser routes mirror backend authorization for review and demo tools', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const login = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerLogin.tsx'), 'utf8');
  assert.match(app, /path="\/reprocess"[\s\S]*allowedRoles=\{\['reviewer', 'admin'\]\}/);
  assert.match(app, /path="\/demo"[\s\S]*allowedRoles=\{\['admin'\]\}/);
  assert.match(app, /path="\/demo-mode"[\s\S]*allowedRoles=\{\['admin'\]\}/);
  // Price Research is intentionally public (2026-08-01 product decision:
  // adaa4e9, 0b92aa3, 0e51450 "remove DealerGate ... no login required").
  assert.match(app, /path="\/price-research" element=\{<PriceResearch \/>\}/);
  assert.match(app, /path="\/cl-login" element=\{<DealerLogin \/>\}/);
  assert.match(app, /path="\/admin-login" element=\{<Navigate to="\/cl-login" replace \/>\}/);
  assert.match(login, /route === '\/review-queue' \|\| route === '\/reprocess'/);
  assert.match(login, /route === '\/demo' \|\| route === '\/demo-mode'/);
});

test('Price Research analytics API is public — no session required', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  // 2026-08-01 product decision (adaa4e9, 0b92aa3, 0e51450): Price Research
  // is public/free access. Guard against the auth gate being silently
  // reintroduced again (it was, once already, by c1f6490 the same day).
  assert.doesNotMatch(source, /authorizeDealer\(req, res\)/);
  assert.doesNotMatch(source, /Sign in is required to access Price Research/);
  assert.match(source, /Cache-Control', 'no-store'/);
});
