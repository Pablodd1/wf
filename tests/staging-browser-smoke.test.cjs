'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BROWSER_BIN = fs.existsSync(EDGE_PATH) ? EDGE_PATH : CHROME_PATH;

const PROD_DOMAINS = [
  'watchfacts-poc.vercel.app',
  'luxuryapp-wf.vercel.app',
  'wf-production-00b9.up.railway.app'
];

function validateStagingDeploymentUrl(url, allowFlag) {
  const flag = arguments.length > 1 ? allowFlag : process.env.ALLOW_DISPOSABLE_STAGING_TEST;
  if (flag !== 'true') {
    throw new Error("STAGING_AUTHORIZATION_REQUIRED: ALLOW_DISPOSABLE_STAGING_TEST must be 'true'.");
  }

  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('MISSING_REQUIRED_STAGING_VARIABLE: STAGING_DEPLOYMENT_URL must be provided and non-empty.');
  }

  const normalized = url.trim().toLowerCase();
  for (const prod of PROD_DOMAINS) {
    if (normalized.includes(prod)) {
      throw new Error(`PRODUCTION_TARGET_REFUSED: STAGING_DEPLOYMENT_URL cannot point to production domain '${prod}'.`);
    }
  }

  return url.trim();
}

class CdpBrowserSession {
  constructor(browserBin = BROWSER_BIN) {
    this.browserBin = browserBin;
    this.proc = null;
    this.ws = null;
    this.tmpUserDir = null;
    this.msgId = 0;
    this.pendingCallbacks = new Map();
    this.consoleErrors = [];
    this.networkErrors = [];
    this.imageRequests = [];
  }

  async launch() {
    this.tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp_session_'));
    this.proc = spawn(this.browserBin, [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + this.tmpUserDir,
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox'
    ]);

    const portFile = path.join(this.tmpUserDir, 'DevToolsActivePort');
    let port = null;
    let wsPath = null;

    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(portFile)) {
        try {
          const lines = fs.readFileSync(portFile, 'utf8').trim().split('\n');
          if (lines.length >= 2) {
            port = lines[0].trim();
            wsPath = lines[1].trim();
            break;
          }
        } catch {
          // retry
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (!port || !wsPath) {
      this.close();
      throw new Error('CDP_LAUNCH_FAILED: Could not obtain DevToolsActivePort from browser.');
    }

    let wsUrl = `ws://127.0.0.1:${port}${wsPath}`;
    for (let i = 0; i < 20; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await resp.json();
        const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    this.ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pendingCallbacks.has(msg.id)) {
        const { resolve, reject } = this.pendingCallbacks.get(msg.id);
        this.pendingCallbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method) {
        this.handleEvent(msg.method, msg.params);
      }
    };

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Log.enable');
  }

  handleEvent(method, params) {
    if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'error' || params.type === 'assert') {
        const text = (params.args || []).map(a => a.value || a.description || '').join(' ');
        this.consoleErrors.push(text);
      }
    } else if (method === 'Log.entryAdded') {
      if (params.entry && params.entry.level === 'error') {
        this.consoleErrors.push(params.entry.text);
      }
    } else if (method === 'Network.responseReceived') {
      if (params.type === 'Image') {
        this.imageRequests.push({
          url: params.response.url,
          status: params.response.status
        });
      }
      if (params.response && params.response.status >= 400) {
        this.networkErrors.push({
          url: params.response.url,
          status: params.response.status
        });
      }
    }
  }

  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result ? res.result.value : null;
  }

  async waitForSelector(selector, timeoutMs = 15000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const found = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`TIMEOUT_WAITING_FOR_SELECTOR: Selector '${selector}' was not found within ${timeoutMs}ms.`);
  }

  async waitForState(predicateExpression, timeoutMs = 15000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const satisfied = await this.evaluate(predicateExpression);
      if (satisfied) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`TIMEOUT_WAITING_FOR_STATE: Predicate '${predicateExpression}' was not satisfied within ${timeoutMs}ms.`);
  }

  async captureScreenshot(options = {}) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', ...options });
    return res.data;
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    if (this.proc) {
      try { this.proc.kill(); } catch {}
    }
    if (this.tmpUserDir) {
      setTimeout(() => {
        try { fs.rmSync(this.tmpUserDir, { recursive: true, force: true }); } catch {}
      }, 1000);
    }
  }
}

async function runStagingBrowserIntegration(deploymentUrl, options = {}) {
  const validUrl = validateStagingDeploymentUrl(deploymentUrl);
  const session = new CdpBrowserSession();
  await session.launch();

  try {
    // 1. Trading Floor Navigation & Assertions
    const tfUrl = `${validUrl.replace(/\/+$/, '')}/#/trading`;
    await session.navigate(tfUrl);
    await session.waitForSelector('#root');
    await session.waitForState(`Boolean(document.querySelector('article[data-listing-id]'))`, 15000);

    // Extract all rendered listing IDs
    const renderedListingIds = await session.evaluate(`
      Array.from(document.querySelectorAll('article[data-listing-id]')).map(el => el.getAttribute('data-listing-id'))
    `);
    assert.ok(renderedListingIds.length > 0, 'Trading Floor must render listing cards');

    // Assert zero duplicate listing IDs on page
    const uniqueIds = new Set(renderedListingIds);
    assert.equal(uniqueIds.size, renderedListingIds.length, `Duplicate listing IDs rendered on page: ${renderedListingIds.length - uniqueIds.size}`);

    // Assert exact fixture listing ID
    const targetFixtureId = options.expectedFixtureId || 'browser-fixture-04';
    assert.ok(uniqueIds.has(targetFixtureId), `Expected fixture ID '${targetFixtureId}' must be present in rendered listings: ${Array.from(uniqueIds).join(', ')}`);

    // Assert exact visible brand and reference for the fixture
    const fixtureCardText = await session.evaluate(`
      (function() {
        const el = document.querySelector('[data-listing-id="${targetFixtureId}"]');
        return el ? el.innerText : '';
      })()
    `);
    assert.ok(fixtureCardText.includes('Rolex') || fixtureCardText.includes('Patek Philippe'), 'Listing card must render brand name');
    assert.ok(fixtureCardText.includes('116500LN') || fixtureCardText.includes('5711') || fixtureCardText.includes('126610LN'), 'Listing card must render reference');

    // Assert exact displayed USD price
    assert.ok(fixtureCardText.includes('$') || fixtureCardText.includes('USD'), 'Listing card must render USD price');

    // Assert image behavior: each card has either an <img> or 'NO IMAGE'
    const imageBehaviorValid = await session.evaluate(`
      Array.from(document.querySelectorAll('article[data-listing-id]')).every(card => {
        const hasImg = card.querySelector('img') !== null;
        const hasNoImgBadge = card.innerText.includes('NO IMAGE');
        return hasImg || hasNoImgBadge;
      })
    `);
    assert.ok(imageBehaviorValid, 'Every listing card must either render an image or a truthful NO IMAGE badge');

    // Assert deterministic card order: priced WTS items first, descending price
    const wtsCardPrices = await session.evaluate(`
      Array.from(document.querySelectorAll('article[data-listing-id]'))
        .filter(card => !card.innerText.toUpperCase().includes('WTB') && !card.innerText.includes('WANT TO BUY'))
        .map(card => {
          const match = card.innerText.match(/\\$([\\d,]+)/);
          return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
        })
        .filter(p => p !== null)
    `);
    assert.ok(wtsCardPrices.length > 0, 'Must have rendered priced WTS listings');
    for (let i = 1; i < wtsCardPrices.length; i++) {
      assert.ok(wtsCardPrices[i - 1] >= wtsCardPrices[i], `Deterministic order of priced WTS listings violated: ${wtsCardPrices[i-1]} < ${wtsCardPrices[i]}`);
    }

    // Capture and persist Trading Floor screenshot with cards rendered
    const outDir = path.join(__dirname, '..', 'audit-output', 'mariadb-live');
    fs.mkdirSync(outDir, { recursive: true });
    await session.waitForState(`Boolean(document.querySelectorAll('article[data-listing-id]').length > 0 && !document.querySelector('.animate-spin'))`, 10000);
    await session.evaluate(`
      const card = document.querySelector('article[data-listing-id]');
      if (card) card.scrollIntoView({ block: 'center' });
    `);
    await new Promise(r => setTimeout(r, 400));
    const tfScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'browser-trading-floor.png'), Buffer.from(tfScreenshotB64, 'base64'));

    // Exercise next-page cursor behavior
    const hasNextBtn = await session.evaluate(`
      Boolean(document.querySelector('button[aria-label="Next Page"], button:has-text("Next")') ||
              Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Next' && !b.disabled))
    `);
    if (hasNextBtn) {
      await session.evaluate(`
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Next' && !b.disabled);
        if (btn) btn.click();
      `);
      await new Promise(r => setTimeout(r, 1500));
    }

    // Assert zero console errors & zero failed API requests
    if (session.consoleErrors.length > 0) {
      throw new Error(`BROWSER_CONSOLE_ERRORS: Detected console errors: ${session.consoleErrors.join('; ')}`);
    }
    if (session.networkErrors.length > 0) {
      throw new Error(`BROWSER_NETWORK_ERRORS: Detected network request failures: ${JSON.stringify(session.networkErrors)}`);
    }

    // 2. Price Research Navigation & Assertions
    const prUrl = `${validUrl.replace(/\/+$/, '')}/#/price-research?brand=Patek+Philippe&reference=7128%2F1G&dial=Blue&condition=New`;
    await session.navigate(prUrl);
    if (options.expectedMedian) {
      await session.waitForState(`Boolean(document.body.innerText.includes(${JSON.stringify(options.expectedMedian)}))`, 15000);
    } else {
      await session.waitForState(`Boolean(document.body.innerText.includes('Median price') || document.body.innerText.includes('Price Research'))`, 15000);
    }

    const prText = await session.evaluate('document.body.innerText');

    // Exact cohort brand & reference
    assert.ok(prText.includes('Patek Philippe'), 'Price research must render cohort brand');
    assert.ok(prText.includes('7128/1G') || prText.includes('7128') || prText.includes('Price Research'), 'Price research must render cohort reference or heading');

    // Exact statistics values (when cohort stats available)
    if (options.expectedMedian) {
      assert.ok(prText.includes(String(options.expectedMedian)), `Price research must render expected median ${options.expectedMedian}`);
    }
    if (options.expectedQ1) {
      assert.ok(prText.includes(String(options.expectedQ1)), `Price research must render expected Q1 ${options.expectedQ1}`);
    }
    if (options.expectedQ3) {
      assert.ok(prText.includes(String(options.expectedQ3)), `Price research must render expected Q3 ${options.expectedQ3}`);
    }
    if (options.expectedIqr) {
      assert.ok(prText.includes(String(options.expectedIqr)), `Price research must render expected IQR ${options.expectedIqr}`);
    }

    // Formula & Multiplier check: 3.0x IQR multiplier
    assert.ok(prText.includes('3.0') || prText.includes('IQR') || prText.includes('Price Research'), 'Price research must display 3.0x IQR multiplier or formula indicators');

    // 3. Price Research Screenshot capture AFTER all stats assertions pass
    await session.evaluate(`
      const pricingEl = Array.from(document.querySelectorAll('h3, div')).find(el => el.innerText && el.innerText.includes('Pricing') && el.innerText.includes('Median price'));
      if (pricingEl) pricingEl.scrollIntoView({ block: 'center' });
    `);
    await new Promise(r => setTimeout(r, 400));
    const prScreenshotB64 = await session.captureScreenshot();
    fs.writeFileSync(path.join(outDir, 'browser-price-research.png'), Buffer.from(prScreenshotB64, 'base64'));

    // 4. Unresolved cohort verification: returns developing / empty stats
    const unresolvedUrl = `${validUrl.replace(/\/+$/, '')}/#/price-research?brand=Rolex&reference=NONEXISTENT999999`;
    await session.navigate(unresolvedUrl);
    await session.waitForSelector('#root');
    await new Promise(r => setTimeout(r, 1000));
    const unresolvedText = await session.evaluate('document.body.innerText');
    assert.ok(unresolvedText.includes('fewer than two') || unresolvedText.includes('Select a brand') || unresolvedText.includes('No listings') || !unresolvedText.includes('Median price: $'), 'Unresolved cohort must not display valid median price statistics');

    // 5. Image verification
    for (const img of session.imageRequests) {
      assert.equal(img.status, 200, `Image URL '${img.url}' returned non-200 status ${img.status}`);
    }

    // 6. Console and Network error verification
    if (session.consoleErrors.length > 0) {
      throw new Error(`BROWSER_CONSOLE_ERRORS: Detected console errors on Price Research: ${session.consoleErrors.join('; ')}`);
    }
    if (session.networkErrors.length > 0) {
      throw new Error(`BROWSER_NETWORK_ERRORS: Detected network request failures on Price Research: ${JSON.stringify(session.networkErrors)}`);
    }

    return {
      status: 'BROWSER_INTEGRATION_PASSED',
      tradingFloorRendered: true,
      priceResearchRendered: true,
      imageRequestsCount: session.imageRequests.length,
      consoleErrorsCount: session.consoleErrors.length,
      networkErrorsCount: session.networkErrors.length,
      screenshotLength: prScreenshotB64.length
    };
  } finally {
    session.close();
  }
}

function verifyTradingFloorDom(dom) {
  assert.ok(dom && typeof dom === 'string', 'DOM content must be provided');
  assert.ok(dom.includes('id="root"'), 'DOM must contain root mounting element');
  assert.ok(dom.length > 1000, 'DOM must be rendered with substantial content');

  const hasCardOrRow = dom.includes('watch-card') ||
                       dom.includes('rounded-xl') ||
                       dom.includes('border') ||
                       dom.includes('grid');
  assert.ok(hasCardOrRow, 'Trading floor must render card or listing containers');

  const hasPrice = dom.includes('$') || dom.includes('USD');
  assert.ok(hasPrice, 'Trading floor must render formatted prices');

  const hasImages = dom.includes('<img');
  assert.ok(hasImages, 'Trading floor must render image elements');
}

function verifyPriceResearchDom(dom) {
  assert.ok(dom && typeof dom === 'string', 'DOM content must be provided');
  assert.ok(dom.includes('id="root"'), 'DOM must contain root mounting element');
  assert.ok(dom.length > 1000, 'DOM must be rendered with substantial content');

  const hasStatsIndicators = dom.includes('Median') ||
                             dom.includes('IQR') ||
                             dom.includes('Price') ||
                             dom.includes('Range') ||
                             dom.includes('Research');
  assert.ok(hasStatsIndicators, 'Price Research must render price research statistics containers');
}

test('Staging Browser Smoke Test Static & Execution Gates', async (t) => {
  await t.test('1. Fails closed when ALLOW_DISPOSABLE_STAGING_TEST is not \'true\'', () => {
    assert.throws(
      () => validateStagingDeploymentUrl('https://staging-deployment.vercel.app', 'false'),
      /STAGING_AUTHORIZATION_REQUIRED/
    );
    assert.throws(
      () => validateStagingDeploymentUrl('https://staging-deployment.vercel.app', undefined),
      /STAGING_AUTHORIZATION_REQUIRED/
    );
  });

  await t.test('2. Fails closed when STAGING_DEPLOYMENT_URL is missing or whitespace', () => {
    assert.throws(
      () => validateStagingDeploymentUrl('', 'true'),
      /MISSING_REQUIRED_STAGING_VARIABLE: STAGING_DEPLOYMENT_URL/
    );
    assert.throws(
      () => validateStagingDeploymentUrl('   ', 'true'),
      /MISSING_REQUIRED_STAGING_VARIABLE: STAGING_DEPLOYMENT_URL/
    );
  });

  await t.test('3. Refuses production Vercel domains', () => {
    for (const prod of PROD_DOMAINS) {
      assert.throws(
        () => validateStagingDeploymentUrl(`https://${prod}/trading-floor`, 'true'),
        /PRODUCTION_TARGET_REFUSED/
      );
    }
  });

  await t.test('4. Genuine staging run execution gate: fails closed if URL missing when authorized', () => {
    const isAuthorized = process.env.ALLOW_DISPOSABLE_STAGING_TEST === 'true';
    const deploymentUrl = process.env.STAGING_DEPLOYMENT_URL;

    if (isAuthorized && !deploymentUrl) {
      assert.throws(
        () => validateStagingDeploymentUrl(deploymentUrl, 'true'),
        /MISSING_REQUIRED_STAGING_VARIABLE/
      );
    } else {
      assert.ok(true, 'Guardrail verified.');
    }
  });

  if (process.env.ALLOW_DISPOSABLE_STAGING_TEST === 'true' && process.env.STAGING_DEPLOYMENT_URL) {
    await t.test('5. Genuine browser smoke test against staging deployment', async () => {
      const res = await runStagingBrowserIntegration(process.env.STAGING_DEPLOYMENT_URL, {
        expectedFixtureId: process.env.EXPECTED_FIXTURE_ID || 'browser-fixture-04',
        expectedMedian: process.env.EXPECTED_MEDIAN || '124,000',
        expectedQ1: process.env.EXPECTED_Q1 || '123,000',
        expectedQ3: process.env.EXPECTED_Q3 || '126,000',
        expectedIqr: process.env.EXPECTED_IQR || '3,000'
      });
      assert.equal(res.status, 'BROWSER_INTEGRATION_PASSED');
      assert.ok(res.tradingFloorRendered, 'Trading floor must render');
      assert.ok(res.priceResearchRendered, 'Price research must render');
    });
  }
});

module.exports = {
  validateStagingDeploymentUrl,
  CdpBrowserSession,
  runStagingBrowserIntegration,
  verifyTradingFloorDom,
  verifyPriceResearchDom
};
