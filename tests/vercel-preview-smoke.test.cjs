'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CdpBrowserSession } = require('./staging-browser-smoke.test.cjs');

async function runVercelPreviewSmoke(previewUrl = process.env.VERCEL_PREVIEW_URL, bypass = process.env.VERCEL_PROTECTION_BYPASS) {
  if (!previewUrl) {
    throw new Error('VERCEL_PREVIEW_URL is required to run Vercel preview smoke tests');
  }
  const session = new CdpBrowserSession();
  await session.launch();

  const outDir = path.join(__dirname, '..', 'audit-output', 'mariadb-live');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    // A host-scoped preview login can be reused without putting a protection
    // credential in a URL, committed fixture or test report.
    const stateFile = process.env.VERCEL_PREVIEW_BROWSER_STATE_FILE;
    if (stateFile) {
      const hostname = new URL(previewUrl).hostname;
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!Array.isArray(state.cookies) || !state.cookies.length
        || state.cookies.some(cookie => cookie.domain.replace(/^\./, '') !== hostname)) {
        throw new Error('Preview browser state must contain cookies only for the requested host');
      }
      const cookies = state.cookies.map(cookie => Object.fromEntries(
        ['name','value','domain','path','secure','httpOnly','sameSite','expires']
          .filter(key => cookie[key] !== undefined).map(key => [key,cookie[key]])
      ));
      await session.send('Network.setCookies', { cookies });
    }
    if (bypass) {
      await session.send('Network.setExtraHTTPHeaders', {
        headers: {
          'x-vercel-protection-bypass': bypass
        }
      });
    }
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    // 1. Trading Floor Navigation
    const tfUrl = `${previewUrl.replace(/\/+$/, '')}/#/trading`;
    await session.navigate(tfUrl);
    await session.waitForSelector('#root');
    await session.waitForState('Boolean(document.body.innerText && document.body.innerText.trim().length > 0)', 15000);
    await session.waitForState('document.querySelector("h1")?.textContent.includes("Trading Floor") === true', 15000);
    await session.waitForState('document.querySelectorAll("article[data-listing-id]").length === 50', 30000);
    const displayedIds = await session.evaluate('Array.from(document.querySelectorAll("article[data-listing-id]"), node => node.dataset.listingId)');
    const apiResult = await session.send('Runtime.evaluate', { expression: 'fetch("/api/canary/trading-floor?pageSize=50").then(response => response.json()).then(body => ({ids:body.records.map(row=>row.listing_id),total:body.total}))', awaitPromise: true, returnByValue: true });
    assert.equal(apiResult.result.value.total, 50);
    assert.deepEqual(displayedIds, apiResult.result.value.ids, 'All 50 rendered identities must match the actual API order');
    assert.equal(new Set(displayedIds).size, 50);

    const title = await session.evaluate('document.title');
    assert.ok(title.includes('Curated Luxury') || title.includes('WatchFacts'), 'Preview title must render');

    const tfText = await session.evaluate('document.body.innerText');
    assert.ok(tfText && tfText.length > 0, 'Trading Floor text must render');

    const tfScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'vercel-preview-trading-floor.png'), Buffer.from(tfScreenshotB64, 'base64'));

    // 2. Price Research Navigation
    const prUrl = `${previewUrl.replace(/\/+$/, '')}/#/price-research?brand=Patek+Philippe&reference=7128%2F1G&dial=Blue&condition=New`;
    await session.navigate(prUrl);
    await session.waitForSelector('#root');
    await session.waitForState('Boolean(document.body.innerText && document.body.innerText.trim().length > 0)', 15000);
    await session.waitForState('document.querySelector("h1")?.textContent.includes("Price Research") === true', 15000);
    const researchSelector = JSON.stringify('button[aria-label^="View source detail for "]');
    await session.waitForState(`document.querySelectorAll(${researchSelector}).length === 4`, 30000);
    const researchLabels = await session.evaluate(`Array.from(document.querySelectorAll(${researchSelector}), node => node.getAttribute("aria-label"))`);
    assert.deepEqual(researchLabels.map(label => label.match(/\$\d{1,3}(?:,\d{3})*/)?.[0]).sort(), ['$100,000', '$105,000', '$90,000', '$95,000']);
    assert.ok(researchLabels.every(label => label.includes('Included in qualified comparable average')));
    await session.evaluate(`document.querySelector(${researchSelector}).scrollIntoView({block:"start"})`);

    const prText = await session.evaluate('document.body.innerText');
    assert.ok(prText.includes('Price Research') || prText.includes('Research') || prText.includes('Patek Philippe'), 'Price research layout must render');

    const prScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'vercel-preview-price-research.png'), Buffer.from(prScreenshotB64, 'base64'));

    return {
      status: 'VERCEL_PREVIEW_PASSED',
      deploymentUrl: previewUrl,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      tradingFloorRenderedCount: displayedIds.length,
      priceResearchRenderedCount: 4,
      tradingFloorScreenshot: 'audit-output/mariadb-live/vercel-preview-trading-floor.png',
      priceResearchScreenshot: 'audit-output/mariadb-live/vercel-preview-price-research.png',
      consoleErrors: session.consoleErrors.length,
      networkErrors: session.networkErrors.length
    };
  } finally {
    session.close();
  }
}

test('Vercel Preview HTTPS CDP Smoke Suite', async (t) => {
  await t.test('1. Navigates to actual Vercel preview deployment over HTTPS and captures UI artifacts', async () => {
    const url = process.env.VERCEL_PREVIEW_URL;
    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    const res = await runVercelPreviewSmoke(url, bypass);
    assert.equal(res.status, 'VERCEL_PREVIEW_PASSED');
  });
});

module.exports = { runVercelPreviewSmoke };
