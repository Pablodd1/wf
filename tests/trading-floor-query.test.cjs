'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Trading Floor filters price-less WTS and recovers a structured HKD price', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  let requestedUrl = '';
  global.fetch = async input => {
    requestedUrl = String(input);
    return {
      ok: true,
      json: async () => [{
        id: 'listing-1',
        brand: 'Patek Philippe',
        reference: '5712/1A',
        price_raw: 780000,
        price_usd: null,
        currency: 'HKD',
        listing_type: 'WTS',
        raw_message: '5712/1A blue full set',
      }],
      headers: { get: name => name.toLowerCase() === 'content-range' ? '0-0/1' : null },
    };
  };

  const handler = require('../api/ingest.js');
  let statusCode = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; },
    end() {},
  };

  try {
    await handler({ method: 'GET', query: { type: 'WTS', page: '1', pageSize: '50' } }, response);
    assert.equal(statusCode, 200);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(
      query.get('and'),
      '(or(verdict.neq.RECYCLE,verdict.is.null),or(listing_type.neq.WTS,price_usd.gt.0,price_raw.gt.0))'
    );
    assert.equal(payload.records[0].price_usd, 100000);
    assert.equal(payload.records[0].price_normalization, 'STRUCTURED_ORIGINAL_PRICE_HKD');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
