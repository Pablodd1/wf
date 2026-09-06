'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { Client } = require('./test-dependencies.cjs')('pg');
const { redactPublicSource } = require('../../api/_lib/source-redaction.cjs');

async function main() {
  const gateway = new URL(process.env.SUPABASE_URL);
  const database = new URL(process.env.DISPOSABLE_DB_URL);
  assert.equal(gateway.origin, 'http://127.0.0.1:54321');
  assert.equal(database.hostname, '127.0.0.1');
  const db = new Client({ connectionString: database.href });
  let server;
  const report = { status: 'RUNNING', recorded_at: new Date().toISOString(), synthetic_only: true,
    production_contacted: false, checks: [], source_mutations: [], transport: 'Local HTTP handlers → real Supabase Kong/PostgREST → PostgreSQL' };
  try {
    await db.connect();
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null as disposable")).rows[0].disposable, true);
    assert.equal((await db.query("select count(*)::int n from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id is distinct from 'RC50_SYNTHETIC_FIXTURE'")).rows[0].n, 0);
    const expected = (await db.query('select * from public.trading_floor_ready_view_v2')).rows;
    assert.equal(expected.length, 50);
    const byId = new Map(expected.map(row => [row.listing_id, row]));
    const handlers = { '/api/canary/trading-floor': require('../../api/canary/trading-floor'),
      '/api/canary/price-research': require('../../api/canary/price-research') };
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      req.query = Object.fromEntries(url.searchParams);
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      const handler = handlers[url.pathname];
      if (handler) handler(req, res); else res.status(404).json({ error: 'Not found' });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = async path => {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const checkCard = row => {
      const source = byId.get(row.listing_id);
      assert.ok(source);
      assert.equal(row.raw_message, source.raw_message_text === null ? null : redactPublicSource(source.raw_message_text));
      assert.equal(row.raw_message_text, row.raw_message);
      assert.equal(row.raw_message_truncated, false);
      assert.equal(row.source_currency, source.original_price_currency);
      assert.equal(row.source_price_amount, source.original_price_amount === null ? null : Number(source.original_price_amount));
      assert.equal(row.seller_name, source.seller_display_name);
      assert.equal(row.listing_date === null ? null : Date.parse(row.listing_date), source.source_created_at === null ? null : Date.parse(source.source_created_at));
      assert.equal(row.has_images, Boolean(row.image_url && row.image_status === 'SOURCE_IMAGE_PRESENT'));
      assert.equal(row.is_unbundled_child, false);
      assert.equal(row.multi_listing, false);
    };
    const seen = new Set();
    let cursor = null, pages = 0, snapshot;
    do {
      const page = await get('/api/canary/trading-floor?pageSize=13' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      assert.equal(page.total, expected.length);
      snapshot ??= page.snapshot;
      assert.equal(page.snapshot, snapshot);
      for (const row of page.records) { checkCard(row); assert.equal(seen.has(row.listing_id), false); seen.add(row.listing_id); }
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages <= 5);
    } while (cursor);
    assert.deepEqual([...seen].sort(), [...byId.keys()].sort());
    report.checks.push({ name: 'All 50 synthetic singles retain exact source/card field values over four real HTTP pages', status: 'PASS', rows: seen.size, pages });
    const research = await get('/api/canary/price-research?pageSize=100');
    assert.equal(research.success, true);
    for (const row of [...research.rows, ...research.demand_rows]) checkCard(row);
    for (const row of research.rows) { assert.equal(row.intent, 'WTS'); assert.equal(row.price_display_verified, true); }
    for (const row of research.demand_rows) { assert.equal(row.intent, 'WTB'); assert.equal(row.price_research_eligible, false); }
    report.checks.push({ name: 'Price Research and separate WTB demand retain the same card contract', status: 'PASS', wts_rows: research.rows.length, wtb_rows: research.demand_rows.length });
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = { code: error.code || error.name, message: error.message.split('\n')[0] }; process.exitCode = 1; }
  finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.end();
    fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
main().catch(error => { console.error('Card API verification failed:', error.code || error.name); process.exitCode = 1; });
