const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';

const handler = require('../api/ingest.js');

function responseRecorder() {
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

async function runQuery(query) {
  let requestedUrl = '';
  const originalFetch = global.fetch;
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response('[]', {
      status: 200,
      headers: { 'content-range': '0-0/0', 'content-type': 'application/json' },
    });
  };

  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query }, res);
    assert.equal(res.statusCode, 200);
    return new URL(requestedUrl);
  } finally {
    global.fetch = originalFetch;
  }
}

test('recent inventory excludes recycle rows and undated imports', async () => {
  const url = await runQuery({ quality: 'market' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('id'), 'not.like.preview_demo_*');
  assert.equal(url.searchParams.get('created_at'), 'not.is.null');
  assert.equal(url.pathname, '/rest/v1/trading_floor_listings');
});

test('all inventory still excludes recycle rows but includes undated imports', async () => {
  const url = await runQuery({ quality: 'archive' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('id'), 'not.like.preview_demo_*');
  assert.equal(url.searchParams.has('created_at'), false);
});

test('reference search reaches dated and undated non-recycle inventory', async () => {
  const url = await runQuery({ quality: 'market', q: '116500LN' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('id'), 'not.like.preview_demo_*');
  assert.equal(url.searchParams.get('reference'), 'eq.116500LN');
  assert.equal(url.searchParams.has('created_at'), false);
});

test('WTB includes NTQ but excludes unsplit bundle parents', async () => {
  const url = await runQuery({ quality: 'archive', type: 'WTB' });
  assert.equal(url.searchParams.get('listing_type'), 'in.(WTB,NTQ)');
  assert.equal(url.pathname, '/rest/v1/trading_floor_listings');
});

test('bulk and trade are not public filters', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Unsupported filters should not query Supabase'); };
  try {
    for (const query of [{ item: 'multi' }, { type: 'TRADE' }]) {
      const res = responseRecorder();
      await handler({ method: 'GET', query }, res);
      assert.equal(res.statusCode, 400);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('public view excludes flagged and deterministically detected bundle parents', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260720113000_exclude_unsplit_bundles_from_public_floor.sql'), 'utf8');
  assert.match(sql, /BUNDLE_SPLIT_REQUIRED/);
  assert.match(sql, /candidate_count > 1/);
  assert.match(sql, /NOT public\.is_unsplit_bundle_parent\(id\)/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = public/);
  assert.match(sql, /unsplit_bundle_parent_ids/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.unsplit_bundle_parent_ids\(TEXT\[\]\) TO service_role/);
});

test('Trading Floor beta route is public and bulk or trade filters are absent', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const floor = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(app, /path="\/trading" element=\{<TradingFloor \/>\}/);
  assert.doesNotMatch(floor, /label: 'Bulk listings'/);
  assert.doesNotMatch(floor, /label: 'Trade'/);
  assert.match(floor, /VIEW BUYER REQUEST/);
  assert.match(floor, /useState<InventoryScope>\('market'\)/);
  assert.match(floor, /Recent inventory/);
  assert.match(floor, /Full archive/);
  assert.match(floor, /Searches still include the complete historical archive/);
});
