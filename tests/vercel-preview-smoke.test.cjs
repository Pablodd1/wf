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
    if (bypass) {
      await session.send('Network.setExtraHTTPHeaders', {
        headers: {
          'x-vercel-protection-bypass': bypass
        }
      });
    }

    // 1. Trading Floor Navigation
    const tfUrl = `${previewUrl.replace(/\/+$/, '')}/#/trading`;
    await session.navigate(tfUrl);
    await session.waitForSelector('#root');
    await session.waitForState('Boolean(document.body.innerText && document.body.innerText.trim().length > 0)', 15000);

    const title = await session.evaluate('document.title');
    assert.ok(title.includes('Curated Luxury') || title.includes('WatchFacts'), 'Preview title must render');

    const tfText = await session.evaluate('document.body.innerText');
    assert.ok(tfText && tfText.length > 0, 'Trading Floor text must render');

    const tfScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'vercel-preview-trading-floor.png'), Buffer.from(tfScreenshotB64, 'base64'));

    // 2. Price Research Navigation
    const prUrl = `${previewUrl.replace(/\/+$/, '')}/#/price-research?brand=Patek+Philippe&reference=7128%2F1G`;
    await session.navigate(prUrl);
    await session.waitForSelector('#root');
    await session.waitForState('Boolean(document.body.innerText && document.body.innerText.trim().length > 0)', 15000);

    const prText = await session.evaluate('document.body.innerText');
    assert.ok(prText.includes('Price Research') || prText.includes('Research') || prText.includes('Patek Philippe'), 'Price research layout must render');

    const prScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'vercel-preview-price-research.png'), Buffer.from(prScreenshotB64, 'base64'));

    return {
      status: 'VERCEL_PREVIEW_PASSED',
      deploymentUrl: previewUrl,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
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
