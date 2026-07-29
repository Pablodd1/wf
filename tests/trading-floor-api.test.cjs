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

test('customer inventory withholds rows when canonical identity is not verified', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify([
    { id: 'bad', brand: 'Patek Philippe', reference: '116610LN', dial_color: 'Black', verdict: 'APPROVED', confidence: 90 },
    { id: 'good', brand: 'Rolex', reference: '116610LN', dial_color: 'Black', verdict: 'APPROVED', confidence: 90 },
  ]), {
    status: 200,
    headers: { 'content-range': '0-1/2', 'content-type': 'application/json' },
  });
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.records.map(row => row.id), []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('customer inventory admits an exact APPROVED 90 row only after canonical identity verification', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const requestUrl = String(url);
    let body = [];
    if (requestUrl.includes('/trading_floor_market_listings?')) {
      body = [{
        id: 'good',
        brand: 'Rolex',
        reference: '116610LN',
        dial_color: 'Black',
        listing_type: 'WTS',
        verdict: 'APPROVED',
        confidence: 90,
        price_usd: 10000,
      }];
    } else if (requestUrl.includes('/listing_identity_reviews?')) {
      body = [{
        record_id: 'good',
        canonical_brand: 'Rolex',
        canonical_model: 'Submariner Date',
        canonical_reference: '116610LN',
        canonical_dial_color: 'Black',
        status: 'CATALOG_CONFIRMED',
      }];
    } else if (requestUrl.includes('/trading_floor_verified_listings?')) {
      const fields = new URL(requestUrl).searchParams.get('select') || '';
      body = fields.includes('brand')
        ? [{
            id: 'good',
            brand: 'Rolex',
            reference: '116610LN',
            dial_color: 'Black',
            listing_type: 'WTS',
            verdict: 'APPROVED',
            confidence: 90,
            price_usd: 10000,
            created_at: '2026-07-27T12:00:00Z',
          }]
        : [{ id: 'good', has_images: false, thumbnail_url: null, image_urls: [] }];
    } else if (requestUrl.includes('/watch_records?')) {
      body = [{
        id: 'good',
        dealer_id: '11111111-1111-4111-8111-111111111111',
        raw_message: 'Rolex 116610LN black USD 10000',
      }];
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-range': '0-0/1', 'content-type': 'application/json' },
    });
  };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.records.map(row => row.id), ['good']);
    assert.equal(res.body.records[0].price_usd, 10000);
    assert.equal(res.body.records[0].price_evidence_status, 'VERIFIED');
    assert.equal(Object.hasOwn(res.body.records[0], 'dealer_id'), false);
    assert.equal(Object.hasOwn(res.body.records[0], 'raw_message'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Panerai inventory reads only the controlled reviewed workbook release', async () => {
  const originalFetch = global.fetch;
  const id = 'reviewed_panerai_auction_1';
  let initialRequest = null;
  global.fetch = async url => {
    const requestUrl = String(url);
    const parsed = new URL(requestUrl);
    const select = parsed.searchParams.get('select') || '';
    let body = [];
    if (requestUrl.includes('/trading_floor_verified_listings?') && select.includes('model')) {
      initialRequest = parsed;
      body = [{
        id,
        brand: 'Panerai',
        model: 'Luminor Marina',
        reference: 'PAM00590',
        dial_color: 'Black',
        condition: 'Used',
        listing_type: 'WTS',
        verdict: 'APPROVED',
        confidence: 100,
        source: 'PANERAI_REVIEWED_XLSX_20260729',
        price_usd: 6500,
        currency: 'USD',
        created_at: '2026-07-01T00:00:00Z',
        has_images: true,
      }];
    } else if (requestUrl.includes('/listing_identity_reviews?')) {
      body = [{
        record_id: id,
        canonical_brand: 'Panerai',
        canonical_model: 'Luminor Marina',
        canonical_reference: 'PAM00590',
        canonical_dial_color: 'Black',
        status: 'HUMAN_APPROVED',
      }];
    } else if (requestUrl.includes('/trading_floor_verified_listings?')) {
      body = [{
        id,
        has_images: true,
        thumbnail_url: 'https://images.example/pam00590.jpg',
        image_urls: ['https://images.example/pam00590.jpg'],
      }];
    } else if (requestUrl.includes('/watch_records?')) {
      body = [{ id, raw_message: 'Panerai PAM00590 Black HKD 50,700' }];
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-range': '0-0/1', 'content-type': 'application/json' },
    });
  };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market', brand: 'Panerai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(initialRequest.pathname, '/rest/v1/trading_floor_verified_listings');
    assert.equal(initialRequest.searchParams.get('id'), 'like.reviewed_panerai_*');
    assert.equal(initialRequest.searchParams.get('select').includes('identity_review_status'), false);
    assert.deepEqual(res.body.records.map(row => row.id), [id]);
    assert.equal(res.body.records[0].price_usd, 6500);
    assert.equal(res.body.records[0].price_evidence_status, 'HUMAN_APPROVED_WORKBOOK');
    assert.equal(res.body.records[0].thumbnail_url, 'https://images.example/pam00590.jpg');
    assert.equal(res.body.publicationScope, 'REVIEWED_FILE');
  } finally {
    global.fetch = originalFetch;
  }
});

test('customer inventory counts one deterministic repost from the same verified dealer', async () => {
  const originalFetch = global.fetch;
  const marketRows = ['newest', 'older'].map((id, index) => ({
    id,
    brand: 'Rolex',
    reference: '116610LN',
    dial_color: 'Black',
    condition: 'Used',
    listing_type: 'WTS',
    verdict: 'APPROVED',
    confidence: 95,
    price_usd: 10000,
    created_at: `2026-07-${27 - index}T12:00:00Z`,
  }));
  global.fetch = async url => {
    const requestUrl = String(url);
    let body = [];
    if (requestUrl.includes('/trading_floor_market_listings?')) {
      body = marketRows;
    } else if (requestUrl.includes('/listing_identity_reviews?')) {
      body = marketRows.map(row => ({
        record_id: row.id,
        canonical_brand: 'Rolex',
        canonical_model: 'Submariner Date',
        canonical_reference: '116610LN',
        canonical_dial_color: 'Black',
        status: 'CATALOG_CONFIRMED',
      }));
    } else if (requestUrl.includes('/trading_floor_verified_listings?')) {
      const fields = new URL(requestUrl).searchParams.get('select') || '';
      body = fields.includes('brand')
        ? marketRows
        : marketRows.map(row => ({
            id: row.id,
            has_images: false,
            thumbnail_url: null,
            image_urls: [],
          }));
    } else if (requestUrl.includes('/watch_records?')) {
      body = marketRows.map(row => ({
        id: row.id,
        dealer_id: '11111111-1111-4111-8111-111111111111',
        raw_message: 'Rolex 116610LN black Used USD 10000',
      }));
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-range': '0-1/2', 'content-type': 'application/json' },
    });
  };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.records.map(row => row.id), ['newest']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('strict cursor pages do not repeat a same-dealer repost across page boundaries', async () => {
  const originalFetch = global.fetch;
  const uniqueRows = Array.from({ length: 12 }, (_, index) => ({
    id: `row_${String(index).padStart(2, '0')}`,
    brand: 'Rolex',
    reference: '116610LN',
    dial_color: 'Black',
    condition: 'Used',
    listing_type: 'WTS',
    verdict: 'APPROVED',
    confidence: 95,
    price_usd: 10000 + index,
    created_at: `2026-07-${String(27 - index).padStart(2, '0')}T12:00:00Z`,
  }));
  const repost = {
    ...uniqueRows[0],
    id: 'row_repost',
    created_at: '2026-07-01T12:00:00Z',
  };
  const marketRows = [...uniqueRows, repost];
  global.fetch = async url => {
    const requestUrl = String(url);
    let body = [];
    if (requestUrl.includes('/listing_identity_reviews?')) {
      body = marketRows.map(row => ({
        record_id: row.id,
        canonical_brand: 'Rolex',
        canonical_model: 'Submariner Date',
        canonical_reference: '116610LN',
        canonical_dial_color: 'Black',
        status: 'CATALOG_CONFIRMED',
        updated_at: row.created_at,
      }));
    } else if (requestUrl.includes('/trading_floor_verified_listings?')) {
      const fields = new URL(requestUrl).searchParams.get('select') || '';
      body = fields.includes('brand')
        ? marketRows
        : marketRows.map(row => ({ id: row.id, has_images: false, thumbnail_url: null, image_urls: [] }));
    } else if (requestUrl.includes('/watch_records?')) {
      body = marketRows.map((row, index) => ({
        id: row.id,
        dealer_id: row.id === 'row_repost'
          ? 'dealer_00'
          : `dealer_${String(index).padStart(2, '0')}`,
        raw_message: `Rolex 116610LN black Used USD ${row.price_usd}`,
      }));
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-range': '0-12/13', 'content-type': 'application/json' },
    });
  };
  try {
    const first = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market', pagination: 'cursor', pageSize: '10' } }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.records.length, 10);
    assert.ok(first.body.nextCursor);

    const second = responseRecorder();
    await handler({
      method: 'GET',
      query: {
        quality: 'market',
        pagination: 'cursor',
        pageSize: '10',
        cursor: first.body.nextCursor,
      },
    }, second);
    assert.equal(second.statusCode, 200);
    const allIds = [...first.body.records, ...second.body.records].map(row => row.id);
    assert.equal(allIds.length, 12);
    assert.equal(new Set(allIds).size, 12);
    assert.equal(allIds.includes('row_repost'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('strict release fails closed when PostgREST returns its 1,000-row ceiling', async () => {
  const originalFetch = global.fetch;
  const identities = Array.from({ length: 1000 }, (_, index) => ({
    record_id: `bounded_${String(index).padStart(4, '0')}`,
    canonical_brand: 'Rolex',
    canonical_model: 'Submariner Date',
    canonical_reference: '116610LN',
    canonical_dial_color: 'Black',
    status: 'CATALOG_CONFIRMED',
    updated_at: '2026-07-27T12:00:00Z',
  }));
  global.fetch = async url => {
    const requestUrl = String(url);
    assert.match(requestUrl, /\/listing_identity_reviews\?/);
    return new Response(JSON.stringify(identities), {
      status: 200,
      headers: { 'content-range': '0-999/*', 'content-type': 'application/json' },
    });
  };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query: { quality: 'market' } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /999-row global repost-deduplication window/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('recent inventory excludes recycle rows and undated imports', async () => {
  const url = await runQuery({ quality: 'market' });
  assert.equal(url.searchParams.get('status'), 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)');
  assert.equal(url.searchParams.get('canonical_reference'), 'in.("116610LN","5712/1A","5712/1A-001","126710BLNR","16202ST","15500ST","15500","15400")');
  assert.equal(url.pathname, '/rest/v1/listing_identity_reviews');
});

test('all inventory still excludes recycle rows but includes undated imports', async () => {
  const url = await runQuery({ quality: 'archive' });
  assert.equal(url.searchParams.get('status'), 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)');
  assert.equal(url.pathname, '/rest/v1/listing_identity_reviews');
});

test('reference search reaches dated and undated eligible market inventory', async () => {
  const url = await runQuery({ quality: 'market', q: '116610LN' });
  assert.equal(url.searchParams.get('canonical_reference'), 'in.("116610LN","5712/1A","5712/1A-001","126710BLNR","16202ST","15500ST","15500","15400")');
  assert.equal(url.pathname, '/rest/v1/listing_identity_reviews');
});

test('WTB includes NTQ but excludes unsplit bundle parents', async () => {
  const url = await runQuery({ quality: 'archive', type: 'WTB' });
  assert.equal(url.searchParams.get('status'), 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)');
  assert.equal(url.pathname, '/rest/v1/listing_identity_reviews');
});

test('watch category and buyer intent can be combined', async () => {
  const url = await runQuery({ quality: 'market', item: 'watches', type: 'WTB' });
  assert.equal(url.searchParams.get('status'), 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)');
  assert.equal(url.pathname, '/rest/v1/listing_identity_reviews');
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
  assert.equal(watches.pathname, '/rest/v1/listing_identity_reviews');

  const all = await runQuery({ quality: 'market', item: 'all' });
  assert.equal(all.pathname, '/rest/v1/listing_identity_reviews');
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
  assert.equal(jewelry.pathname, '/rest/v1/listing_identity_reviews');

  const handbags = await runQuery({ quality: 'market', item: 'handbags' });
  assert.equal(handbags.pathname, '/rest/v1/listing_identity_reviews');

  const accessories = await runQuery({ quality: 'market', item: 'accessories' });
  assert.equal(accessories.pathname, '/rest/v1/listing_identity_reviews');

  const other = await runQuery({ quality: 'market', item: 'other' });
  assert.equal(other.pathname, '/rest/v1/listing_identity_reviews');
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
