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

test('customer inventory quarantines catalog-proven cross-brand rows', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify([
    { id: 'bad', brand: 'Audemars Piguet', reference: 'RM 17-01', dial_color: 'Skeleton' },
    { id: 'good', brand: 'Richard Mille', reference: 'RM 17-01', dial_color: 'Skeleton' },
  ]), {
    status: 200,
    headers: { 'content-range': '0-1/2', 'content-type': 'application/json' },
  });
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.records.map(row => row.id), ['good']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('recent inventory excludes recycle rows and undated imports', async () => {
  const url = await runQuery({ quality: 'market' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('id'), 'not.like.preview_demo_*');
  assert.equal(url.searchParams.get('created_at'), 'not.is.null');
  assert.equal(url.pathname, '/rest/v1/trading_floor_market_listings');
});

test('all inventory still excludes recycle rows but includes undated imports', async () => {
  const url = await runQuery({ quality: 'archive' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('id'), 'not.like.preview_demo_*');
  assert.equal(url.searchParams.has('created_at'), false);
  assert.equal(url.pathname, '/rest/v1/trading_floor_listings');
});

test('reference search reaches dated and undated eligible market inventory', async () => {
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

test('watch category and buyer intent can be combined', async () => {
  const url = await runQuery({ quality: 'market', item: 'watches', type: 'WTB' });
  assert.equal(url.searchParams.get('listing_type'), 'in.(WTB,NTQ)');
  assert.equal(url.pathname, '/rest/v1/trading_floor_market_listings');
});

test('strict market view requires complete watch identity and a plausible WTS price', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260722120000_strict_market_publication_view.sql'), 'utf8');
  assert.match(sql, /CREATE OR REPLACE VIEW public\.trading_floor_market_listings/);
  assert.match(sql, /NULLIF\(trim\(brand\), ''\) IS NOT NULL/);
  assert.match(sql, /NULLIF\(trim\(reference\), ''\) IS NOT NULL/);
  assert.match(sql, /NULLIF\(trim\(dial_color\), ''\) IS NOT NULL/);
  assert.match(sql, /listing_type IN \('WTB', 'NTQ'\)/);
  assert.match(sql, /listing_type = 'WTS'[\s\S]*price_usd >= 1000/);
});

test('public inventory excludes multi, trade, and unrecognized listing types', async () => {
  const watches = await runQuery({ quality: 'market', item: 'watches' });
  assert.equal(watches.searchParams.get('listing_type'), 'in.(WTS,WTB,NTQ)');

  const all = await runQuery({ quality: 'market', item: 'all' });
  assert.equal(all.searchParams.get('listing_type'), 'in.(WTS,WTB,NTQ,OTHER)');
});

test('unnormalized luxury records reject unsupported intent combinations', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Invalid combination should not query Supabase'); };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { item: 'luxury', type: 'WTS' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /unavailable for unnormalized luxury/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('non-watch categories use source evidence and remain separate from intent', async () => {
  const jewelry = await runQuery({ quality: 'market', item: 'jewelry' });
  assert.equal(jewelry.searchParams.get('listing_type'), 'eq.OTHER');
  assert.equal(jewelry.searchParams.get('source_type'), 'eq.jewelry_archive');

  const handbags = await runQuery({ quality: 'market', item: 'handbags' });
  assert.equal(handbags.searchParams.get('source_type'), 'in.(handbag_archive,handbags_archive,bag_archive)');

  const accessories = await runQuery({ quality: 'market', item: 'accessories' });
  assert.equal(accessories.searchParams.get('source_type'), 'in.(accessory_archive,accessories_archive)');

  const other = await runQuery({ quality: 'market', item: 'other' });
  assert.equal(other.searchParams.get('listing_type'), 'eq.OTHER');
  assert.equal(other.searchParams.get('source_type'), 'not.in.(jewelry_archive,handbag_archive,handbags_archive,bag_archive,accessory_archive,accessories_archive)');
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
  const header = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MarketHeader.tsx'), 'utf8');
  assert.match(app, /path="\/trading" element=\{<TradingFloor \/>\}/);
  assert.doesNotMatch(floor, /label: 'Bulk listings'/);
  assert.doesNotMatch(floor, /label: 'Trade'/);
  assert.match(floor, /VIEW BUYER REQUEST/);
  assert.match(floor, /const inventoryScope: InventoryScope = searchParams\.get\('scope'\) === 'archive' \? 'archive' : 'market'/);
  assert.match(floor, /Main inventory/);
  assert.match(floor, /Full archive/);
  assert.match(floor, /Main indexed inventory first/);
  assert.match(floor, /const categoryFilter = CATEGORY_OPTIONS\.some/);
  assert.match(floor, /const intentFilter = \['all', 'watches'\]\.includes\(categoryFilter\)/);
  assert.match(floor, /MobileFilterSheet/);
  assert.match(floor, /Filter inventory/);
  assert.match(floor, /View results/);
  assert.match(floor, /matchMedia\('\(max-width: 640px\)'\)/);
  assert.match(floor, /media\.addEventListener\('change', updatePageSize\)/);
  assert.match(floor, /if \(nextSearch !== search \|\| nextRegion !== regionFilter\)/);
  assert.match(floor, /setSearchParams\(next, \{ replace: true \}\)/);
  assert.match(floor, /listScrollPositionRef\.current = window\.scrollY/);
  assert.match(floor, /window\.scrollTo\(\{ top: restoreTo, behavior: 'auto' \}\)/);
  assert.match(floor, /onClose=\{closeListing\}/);
  assert.match(floor, /previousViewKeyRef\.current === viewKey/);
  assert.match(floor, /Back to results/);
  assert.match(header, /overflow-x-auto/);
  assert.match(header, /h-11 shrink-0/);
  assert.match(header, /sm:flex-row/);
});
