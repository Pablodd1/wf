'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const hold = require('../api/_lib/rolex-patek-publication-hold.cjs');

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

test('publication hold defaults fail-closed only in production and has an explicit rollback', () => {
  assert.equal(hold.isRolexPatekPublicationHeld({ VERCEL_ENV: 'production' }), true);
  assert.equal(hold.isRolexPatekPublicationHeld({ VERCEL_ENV: 'preview' }), false);
  assert.equal(hold.isRolexPatekPublicationHeld({ VERCEL_ENV: 'production', ROLEX_PATEK_PUBLICATION_MODE: 'live' }), false);
  assert.equal(hold.isRolexPatekPublicationHeld({ VERCEL_ENV: 'preview', ROLEX_PATEK_PUBLICATION_MODE: 'background' }), true);
  assert.equal(hold.isRolexPatekBrand('Rolex'), true);
  assert.equal(hold.isRolexPatekBrand('patek philippe'), true);
  assert.equal(hold.isRolexPatekBrand('Tudor'), false);
});

test('Trading Floor feed returns no Rolex or Patek rows before touching the database', { concurrency: false }, async () => {
  const previousEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const handler = require('../api/reviewed-market-inventory.js');
    for (const brand of ['Rolex', 'Patek Philippe']) {
      const res = responseCapture();
      await handler({ method: 'GET', query: { brand, item: 'watches', pageSize: '50' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.release_status, 'BACKGROUND_VERIFICATION');
      assert.deepEqual(res.body.records, []);
      assert.equal(res.body.total, 0);
      assert.equal(res.body.source, hold.BACKGROUND_HOLD_SOURCE);
    }
  } finally {
    if (previousEnv == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});

test('Price Research rejects held Rolex and Patek references before database work', { concurrency: false }, async () => {
  const previousEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const handler = require('../api/price-research.js');
    for (const [brand, reference] of [['Rolex', '126500LN'], ['Patek Philippe', '5711/1A']]) {
      const res = responseCapture();
      await handler({ method: 'GET', query: { brand, reference } }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.release_status, 'BACKGROUND_VERIFICATION');
      assert.equal(res.body.source, hold.BACKGROUND_HOLD_SOURCE);
    }
  } finally {
    if (previousEnv == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});

test('all public read paths and production UI selectors enforce the shared hold', () => {
  const tradingDetail = fs.readFileSync(path.join(root, 'api/trading-listing.js'), 'utf8');
  const researchDetail = fs.readFileSync(path.join(root, 'api/price-research-listing.js'), 'utf8');
  const tradingUi = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
  const researchUi = fs.readFileSync(path.join(root, 'src/pages/PriceResearch.tsx'), 'utf8');
  const uiHold = fs.readFileSync(path.join(root, 'src/utils/rolexPatekPublication.ts'), 'utf8');

  assert.match(tradingDetail, /isRolexPatekPublicationHeld\(\) && isRolexPatekBrand\(publicListing\.brand\)/);
  assert.match(researchDetail, /rejectHeldRolexPatek\(res, qnsaListing\.brand\)/);
  assert.match(researchDetail, /rejectHeldRolexPatek\(res, workbookListing\.brand\)/);
  assert.match(researchDetail, /rejectHeldRolexPatek\(res, resolvedData\.brand\)/);
  assert.match(tradingUi, /MASTER_BRAND_LIST[\s\S]*filter\(brand => !isHeldRolexPatekBrand\(brand\)\)/);
  assert.match(researchUi, /DEFAULT_RESEARCH_BRANDS[\s\S]*filter\(brand => !isHeldRolexPatekBrand\(brand\)\)/);
  assert.match(uiHold, /import\.meta\.env\.PROD/);
  assert.match(uiHold, /configuredMode === 'live'/);
});
