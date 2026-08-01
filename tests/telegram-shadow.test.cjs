'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shadow = require('../api/_lib/telegram-shadow.cjs');
const worker = require('../tools/telegram-shadow/process-events.cjs');

function response() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function update(overrides = {}) {
  return {
    update_id: 123,
    message: {
      message_id: 77,
      date: 1785595200,
      chat: { id: -100123, type: 'supergroup', title: 'Pilot Group' },
      from: { id: 99, username: 'dealer', first_name: 'Test', last_name: 'Dealer' },
      caption: 'WTS Rolex 116500LN black USD 30000',
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 90, height: 90, file_size: 100 },
        { file_id: 'large', file_unique_id: 'l', width: 1280, height: 1280, file_size: 5000 },
      ],
      ...overrides,
    },
  };
}

test('builds an immutable Telegram evidence envelope with the largest photo', () => {
  const event = shadow.buildShadowEvent(update());
  assert.equal(event.external_message_id, '-100123:77:message');
  assert.equal(event.chat_id, '-100123');
  assert.equal(event.raw_text, 'WTS Rolex 116500LN black USD 30000');
  assert.equal(event.media.length, 1);
  assert.equal(event.media[0].file_id, 'large');
  assert.equal(event.sender_display_name, 'Test Dealer');
});

test('shadow capture fails closed when disabled or a chat is not allowlisted', async () => {
  const priorEnabled = process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED;
  const priorAllowlist = process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS;
  try {
    delete process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED;
    assert.deepEqual(await shadow.captureTelegramUpdate(update()), {
      accepted: false,
      reason: 'SHADOW_CAPTURE_DISABLED',
    });

    process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED = 'true';
    process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS = '-100999';
    assert.deepEqual(await shadow.captureTelegramUpdate(update()), {
      accepted: false,
      reason: 'CHAT_NOT_ALLOWLISTED',
    });
  } finally {
    if (priorEnabled === undefined) delete process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED;
    else process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED = priorEnabled;
    if (priorAllowlist === undefined) delete process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS;
    else process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS = priorAllowlist;
  }
});

test('capture is idempotent and never invokes normalization or publication', async () => {
  const names = ['TELEGRAM_SHADOW_CAPTURE_ENABLED', 'TELEGRAM_SHADOW_ALLOWED_CHAT_IDS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED = 'true';
    process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS = '-100123';
    process.env.SUPABASE_URL = 'https://shadow.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    global.fetch = async (url, options) => {
      calls += 1;
      assert.match(String(url), /telegram_ingest_shadow_events/);
      assert.equal(options.method, 'POST');
      assert.doesNotMatch(String(url), /watch_records/);
      return { ok: true, status: 201, json: async () => calls === 1 ? [{ id: 'event-1' }] : [] };
    };

    const first = await shadow.captureTelegramUpdate(update());
    const replay = await shadow.captureTelegramUpdate(update());
    assert.deepEqual(first, { accepted: true, duplicate: false, event_id: 'event-1' });
    assert.deepEqual(replay, { accepted: true, duplicate: true, event_id: null });
  } finally {
    global.fetch = originalFetch;
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});

test('deterministic worker preserves exact raw-line price evidence', () => {
  const result = worker.deterministicSuggestion('WTS Rolex 116500LN black USD 30000');
  assert.equal(result.candidate_count, 1);
  assert.equal(result.candidates[0].reference, '116500LN');
  assert.equal(result.candidates[0].prices[0].amount_original, 30000);
  assert.equal(result.candidates[0].prices[0].currency_original, 'USD');
  assert.equal(result.candidates[0].prices[0].currency_evidence, 'explicit_line_currency');
});

test('ordinary allowlisted group posts are captured without a bot reply', async () => {
  const names = [
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_SHADOW_CAPTURE_ENABLED',
    'TELEGRAM_SHADOW_ALLOWED_CHAT_IDS',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../api/telegram-bot.js');
  let calls = 0;
  try {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
    process.env.TELEGRAM_SHADOW_CAPTURE_ENABLED = 'true';
    process.env.TELEGRAM_SHADOW_ALLOWED_CHAT_IDS = '-100123';
    process.env.SUPABASE_URL = 'https://shadow.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    global.fetch = async url => {
      calls += 1;
      assert.match(String(url), /telegram_ingest_shadow_events/);
      return { ok: true, status: 201, json: async () => [{ id: 'event-1' }] };
    };
    delete require.cache[modulePath];
    const handler = require(modulePath);
    const res = response();
    await handler({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
      body: update({ text: 'WTS Rolex 116500LN black USD 30000', caption: undefined, photo: undefined }),
    }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.shadow.accepted, true);
    assert.equal(calls, 1, 'the handler must not call Telegram sendMessage for an ordinary post');
  } finally {
    delete require.cache[modulePath];
    global.fetch = originalFetch;
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});

test('worker claims only shadow events and writes review suggestions', async () => {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_SHADOW_VISION_ENABLED'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const urls = [];
  try {
    process.env.SUPABASE_URL = 'https://shadow.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    delete process.env.TELEGRAM_SHADOW_VISION_ENABLED;
    console.log = () => {};
    global.fetch = async (url, options) => {
      urls.push(String(url));
      if (String(url).includes('/rpc/claim_telegram_shadow_events')) {
        assert.equal(options.method, 'POST');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{
            id: 'event-1',
            raw_text: 'WTS Rolex 116500LN black USD 30000',
            media: [],
          }]),
        };
      }
      assert.match(String(url), /telegram_ingest_shadow_results/);
      return { ok: true, status: 201, text: async () => '' };
    };
    await worker.run();
    assert.equal(urls.length, 2);
    assert.equal(urls.some(url => /watch_records|trading_floor|price_research/i.test(url)), false);
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});

test('Telegram shadow implementation has no production listing target', () => {
  const files = [
    path.join(__dirname, '..', 'api', '_lib', 'telegram-shadow.cjs'),
    path.join(__dirname, '..', 'tools', 'telegram-shadow', 'process-events.cjs'),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /watch_records|trading_floor|price_research/i);
  }
  const migration = fs.readFileSync(path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260801120000_telegram_ingest_shadow.sql',
  ), 'utf8');
  assert.match(migration, /FOR UPDATE OF event SKIP LOCKED/);
  assert.match(migration, /p_max_attempts/);
});
