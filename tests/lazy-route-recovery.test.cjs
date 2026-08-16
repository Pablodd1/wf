'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

async function recoveryModule() {
  return import('../src/lazy-route-recovery.ts');
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('stale dynamic import requests one versioned session recovery only', async () => {
  const { loadRouteModuleWithRecovery, routeRecoveryGuardKey } = await recoveryModule();
  const storage = memoryStorage();
  let reloads = 0;
  const failure = new TypeError('Failed to fetch dynamically imported module: /assets/PriceResearch-old.js');
  const options = { buildId: 'deploy-a', routeKey: 'price-research', storage, reload: () => { reloads += 1; } };

  await assert.rejects(loadRouteModuleWithRecovery(async () => { throw failure; }, options), failure);
  assert.equal(reloads, 1);
  assert.equal(storage.getItem(routeRecoveryGuardKey('deploy-a', 'price-research')), 'attempted');

  await assert.rejects(loadRouteModuleWithRecovery(async () => { throw failure; }, options), failure);
  assert.equal(reloads, 1, 'the same build and route must not enter a reload loop');
});

test('a refreshed route can load successfully while retaining the loop guard', async () => {
  const { loadRouteModuleWithRecovery, routeRecoveryGuardKey } = await recoveryModule();
  const storage = memoryStorage();
  storage.setItem(routeRecoveryGuardKey('deploy-b', 'price-research'), 'attempted');
  const expected = { default: () => null };
  const loaded = await loadRouteModuleWithRecovery(async () => expected, {
    buildId: 'deploy-b', routeKey: 'price-research', storage, reload: () => assert.fail('reload was not expected'),
  });
  assert.equal(loaded, expected);
});

test('non-chunk failures and unavailable session storage fall through to the visible boundary', async () => {
  const { loadRouteModuleWithRecovery } = await recoveryModule();
  let reloads = 0;
  await assert.rejects(loadRouteModuleWithRecovery(async () => { throw new Error('page render failed'); }, {
    buildId: 'deploy-c', routeKey: 'trading-floor', storage: memoryStorage(), reload: () => { reloads += 1; },
  }), /page render failed/);
  await assert.rejects(loadRouteModuleWithRecovery(async () => {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/TradingFloor-old.js');
  }, {
    buildId: 'deploy-c', routeKey: 'trading-floor',
    storage: { getItem: () => { throw new Error('disabled'); }, setItem: () => undefined },
    reload: () => { reloads += 1; },
  }), /Failed to fetch dynamically imported module/);
  assert.equal(reloads, 0);
});

test('route fallback is visible and the recovery guard is tied to the deployment build', () => {
  const boundary = fs.readFileSync(path.join(__dirname, '../src/components/RouteLoadBoundary.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  const vite = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8');
  assert.match(boundary, /role="alert"/);
  assert.match(boundary, /This page needs a refresh/);
  assert.match(boundary, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(app, /RouteLoadBoundary resetKey=\{`\$\{location\.pathname\}\$\{location\.search\}`\}/);
  assert.match(app, /recoverableRoute\('price-research'/);
  assert.match(vite, /VERCEL_GIT_COMMIT_SHA \|\| process\.env\.VERCEL_DEPLOYMENT_ID \|\| 'local'/);
});
