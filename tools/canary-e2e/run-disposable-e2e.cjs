#!/usr/bin/env node
'use strict';

/**
 * WatchFacts V2 Phase 10 — Genuine Disposable-Environment Canary E2E Runner
 *
 * Supersedes tools/mariadb-live/run-disposable-browser-suite.py (which hard-coded
 * trading_floor_verified / price_research_verified and fabricated an
 * empirical_browser_execution block; that file is intentionally left untouched).
 *
 * This runner executes, in a single process and with zero external network access:
 *   1. Boots a disposable embedded-postgres instance (no external hosts).
 *   2. Applies the full wf_canonical_staging canary migration chain
 *      (20260902130000 .. 20260907120000, phases 2-7 + RC50 F2 SQL).
 *   3. Seeds clearly-labelled SYNTHETIC fixtures (no real contacts, phones, or
 *      raw payloads): deterministic-ordering rows, multi-page keyset traversal
 *      volume, an ineligible-but-priced boundary row (Phase 5 F-A regression),
 *      a bundle parent with published children (Phase 6 suppression), a
 *      duplicate/repost pair, a computable Price Research cohort
 *      (Patek Philippe 7128/1G Blue New), and an unresolved cohort.
 *   4. Serves the real built frontend (dist/) plus the REAL api/canary handlers
 *      behind a minimal loopback HTTP shim; supabase-js is pointed at a
 *      loopback PostgREST-RPC shim that executes SQL against the embedded PG.
 *   5. Drives headless Chromium via CDP (BROWSER_BIN env override, defaults to
 *      /usr/bin/chromium) performing REAL browser assertions with pass/fail
 *      evidence, screenshots, and zero-tolerance console/network error counts.
 *   6. Writes an immutable results JSON where every field derives from an
 *      executed assertion; anything not executed is NOT_RUN with a reason.
 *      Exit code is non-zero if any executed assertion FAILs.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const FORBIDDEN_PROD_IDENTIFIER = 'bptrvfncppbjnchsaxtb';

/* ------------------------------------------------------------------ *
 * Safety: fail-closed environment guard.
 * ------------------------------------------------------------------ */
function assertDisposableEnvironment() {
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && value.includes(FORBIDDEN_PROD_IDENTIFIER)) {
      throw new Error(`PRODUCTION_IDENTIFIER_REFUSED: environment variable ${key} references a production identifier; aborting.`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Results ledger — every assertion executed records evidence.
 * ------------------------------------------------------------------ */
class AssertionLedger {
  constructor() {
    this.assertions = [];
  }
  record(id, surface, status, evidence) {
    const entry = { id, surface, status, evidence: evidence || {}, at: new Date().toISOString() };
    this.assertions.push(entry);
    console.log(`[${status}] ${id}${evidence && evidence.detail ? ' :: ' + evidence.detail : ''}`);
    return entry;
  }
  pass(id, surface, evidence) { return this.record(id, surface, 'PASS', evidence); }
  fail(id, surface, evidence) { return this.record(id, surface, 'FAIL', evidence); }
  notRun(id, surface, reason) { return this.record(id, surface, 'NOT_RUN', { reason }); }
  async check(id, surface, fn) {
    try {
      const evidence = await fn();
      return this.pass(id, surface, evidence || {});
    } catch (err) {
      return this.fail(id, surface, { error: String(err && err.message || err) });
    }
  }
  summary() {
    const s = { PASS: 0, FAIL: 0, NOT_RUN: 0 };
    for (const a of this.assertions) s[a.status] = (s[a.status] || 0) + 1;
    return s;
  }
}

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

/* ------------------------------------------------------------------ *
 * Minimal CDP browser session (Linux-aware; adapted from
 * tests/staging-browser-smoke.test.cjs which hard-codes Windows paths).
 * ------------------------------------------------------------------ */
function resolveBrowserBin() {
  const candidates = [
    process.env.BROWSER_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('BROWSER_BIN_UNAVAILABLE: no chromium binary found; set BROWSER_BIN.');
}

/* ------------------------------------------------------------------ *
 * Minimal RFC6455 WebSocket client (Node 20 lacks the global WebSocket;
 * used only for loopback CDP transport to the disposable browser).
 * ------------------------------------------------------------------ */
class MinimalWebSocket {
  constructor(url) {
    const u = new URL(url);
    this.url = u;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this._buf = Buffer.alloc(0);
    this._frag = null;
    this._sock = net.connect(Number(u.port), u.hostname, () => {
      const key = crypto.randomBytes(16).toString('base64');
      this._sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    this._handshaken = false;
    this._sock.on('data', (chunk) => this._onData(chunk));
    this._sock.on('error', (err) => { if (this.onerror) this.onerror(err); });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    if (!this._handshaken) {
      const idx = this._buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = this._buf.slice(0, idx).toString('latin1');
      this._buf = this._buf.slice(idx + 4);
      if (!/^HTTP\/1\.1 101/.test(head)) {
        if (this.onerror) this.onerror(new Error(`WS handshake failed: ${head.split('\r\n')[0]}`));
        return;
      }
      this._handshaken = true;
      if (this.onopen) this.onopen();
    }
    for (;;) {
      if (this._buf.length < 2) return;
      const b0 = this._buf[0], b1 = this._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this._buf.length < 4) return;
        len = this._buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this._buf.length < 10) return;
        len = Number(this._buf.readBigUInt64BE(2)); off = 10;
      }
      if (this._buf.length < off + len) return;
      const payload = this._buf.slice(off, off + len);
      this._buf = this._buf.slice(off + len);
      if (opcode === 0x9) { this._sendFrame(0xA, payload); continue; } // ping -> pong
      if (opcode === 0x8) { continue; } // close
      if (opcode === 0x1 || opcode === 0x2) {
        this._frag = fin ? null : payload;
        if (fin && this.onmessage) this.onmessage({ data: payload.toString('utf8') });
      } else if (opcode === 0x0 && this._frag !== null) {
        const full = Buffer.concat([this._frag, payload]);
        if (fin) { this._frag = null; if (this.onmessage) this.onmessage({ data: full.toString('utf8') }); }
        else this._frag = full;
      }
    }
  }

  _sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this._sock.write(Buffer.concat([head, mask, masked]));
  }

  send(data) { this._sendFrame(0x1, Buffer.from(String(data), 'utf8')); }
  close() { try { this._sendFrame(0x8, Buffer.alloc(0)); } catch {} try { this._sock.destroy(); } catch {} }
}

const WSImpl = typeof WebSocket !== 'undefined' ? WebSocket : MinimalWebSocket;

// @supabase/supabase-js (realtime transport) requires a global WebSocket on
// Node <22. The canary handlers only use PostgREST RPC over plain fetch, so a
// no-op stub satisfies the transport probe without opening any socket.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class StubWebSocket {
    constructor() { this.readyState = 3; }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
}

class CdpBrowserSession {
  constructor(browserBin) {
    this.browserBin = browserBin;
    this.proc = null;
    this.ws = null;
    this.tmpUserDir = null;
    this.msgId = 0;
    this.pendingCallbacks = new Map();
    this.consoleErrors = [];
    this.networkErrors = [];
    this.requestUrls = new Map();
  }

  async launch() {
    this.tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10_cdp_'));
    this.proc = spawn(this.browserBin, [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + this.tmpUserDir,
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--window-size=1440,900',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr.on('data', () => {});

    const portFile = path.join(this.tmpUserDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(portFile)) {
        const lines = fs.readFileSync(portFile, 'utf8').trim().split('\n');
        if (lines.length >= 2) { port = lines[0].trim(); break; }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if (!port) { this.close(); throw new Error('CDP_LAUNCH_FAILED: no DevToolsActivePort'); }

    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await resp.json();
        const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    if (!wsUrl) { this.close(); throw new Error('CDP_LAUNCH_FAILED: no page target'); }

    this.ws = new WSImpl(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pendingCallbacks.has(msg.id)) {
        const { resolve, reject } = this.pendingCallbacks.get(msg.id);
        this.pendingCallbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
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
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      this.consoleErrors.push(`UNCAUGHT_EXCEPTION: ${d.text || ''} ${(d.exception && (d.exception.description || d.exception.value)) || ''}`);
    } else if (method === 'Log.entryAdded') {
      if (params.entry && params.entry.level === 'error') {
        this.consoleErrors.push(params.entry.text);
      }
    } else if (method === 'Network.responseReceived') {
      if (params.response && params.response.status >= 400) {
        this.networkErrors.push({ url: params.response.url, status: params.response.status });
      }
    } else if (method === 'Network.requestWillBeSent') {
      this.requestUrls.set(params.requestId, params.request && params.request.url);
    } else if (method === 'Network.loadingFailed') {
      const p = params;
      if (p && p.errorText && !/net::ERR_ABORTED/.test(p.errorText)) {
        this.networkErrors.push({ errorText: p.errorText, type: p.type, url: this.requestUrls.get(p.requestId) || null });
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
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error('EVAL_EXCEPTION: ' + JSON.stringify(res.exceptionDetails.text));
    }
    return res.result ? res.result.value : null;
  }

  async waitForState(predicateExpression, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await this.evaluate(predicateExpression)) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`TIMEOUT_WAITING_FOR_STATE: ${predicateExpression}`);
  }

  async captureScreenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    return filePath;
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch {} }
    if (this.proc) { try { this.proc.kill('SIGKILL'); } catch {} }
    if (this.tmpUserDir) {
      setTimeout(() => { try { fs.rmSync(this.tmpUserDir, { recursive: true, force: true }); } catch {} }, 1000);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const CANARY_MIGRATIONS = [
  '20260902130000_v2_canary_forward_migration.sql',
  '20260905120000_v2_canary_hardening_forward.sql',
  '20260905130000_price_research_stats_hardening.sql',
  '20260905140000_snapshot_keyset_pagination_forward.sql',
  '20260905150000_phase4_1_stats_breakdown_fix.sql',
  '20260905160000_phase5_1_snapshot_cursor_frozen_keys.sql',
  '20260905170000_demand_keyset_forward.sql',
  '20260906120000_phase6_surface_separation_forward.sql',
  '20260907120000_snapshot_payload_freeze_forward.sql',
  '20260907130000_snapshot_counts_forward.sql',
  '20260907150000_shared_publication_snapshots.sql',
  '20260907160000_snapshot_statistics.sql',
  '20260907170000_contact_rate_limit.sql',
];

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/* ------------------------------------------------------------------ *
 * Synthetic fixture builder. All rows are clearly-labelled synthetic
 * canary fixtures; no real contacts, phones, or raw source payloads.
 * ------------------------------------------------------------------ */
function buildFixtures() {
  const rows = [];
  const base = Date.UTC(2026, 7, 20, 12, 0, 0); // ms-aligned (cursor roundtrip safety)
  let i = 0;
  const mk = (over) => {
    i += 1;
    const id = over.listing_id || `P10SYN-${String(i).padStart(3, '0')}`;
    const seedText = `synthetic-fixture ${id}`;
    return Object.assign({
      contract_version: 'v2.0',
      listing_id: id,
      parent_listing_id: null,
      child_index: null,
      source_id: `SYN-SRC-${id}`,
      source_hash: sha256(seedText),
      raw_message_id: `SYN-MSG-${id}`,
      raw_message_text: `[SYNTHETIC CANARY FIXTURE] ${id} - not a real listing`,
      source_context_text: `[SYNTHETIC] fixture context for ${id}`,
      source_created_at: new Date(base + i * 60000).toISOString(),
      observed_at: new Date(base + i * 60000).toISOString(),
      category: 'wristwatches',
      brand: 'Synthetix',
      model: `Model-${id}`,
      reference: `SYN-${id}`,
      dial_color: 'Black',
      year: 2024,
      condition: 'Excellent',
      intent: 'WTS',
      intent_status: null,
      title: `[SYNTHETIC] ${id}`,
      description: `[SYNTHETIC] fixture row ${id}; contains no real-world data.`,
      original_price_text: 'USD 0',
      original_price_amount: 0,
      original_price_currency: 'USD',
      price_usd: null,
      fx_rate: null,
      fx_source: null,
      fx_date: null,
      price_status: 'VERIFIED_SOURCE_PRICE',
      price_research_eligible: false,
      included_in_statistics: false,
      statistics_exclusion_reason: null,
      image_url: null,
      thumbnail_url: null,
      // image_key is intentionally null: the display contract synthesizes an
      // external CDN URL from any non-blank key, and this runner must stay
      // strictly loopback. NO_IMAGE keeps image_rank uniform across fixtures.
      image_key: null,
      image_evidence_type: 'NO_IMAGE',
      image_status: 'NO_IMAGE',
      seller_id: `SYN-SELLER-${id}`,
      seller_display_name: `Synthetic Seller ${id}`,
      seller_profile_url: null,
      seller_review_count: null,
      seller_listing_count: null,
      seller_wts_count: null,
      seller_wtb_count: null,
      contact_available: false,
      location_country: 'Testland',
      location_region: 'Test Region',
      is_bundle: false,
      bundle_child_count: null,
      duplicate_group_id: null,
      review_status: 'REVIEW_NOT_REQUIRED',
      review_reasons: [],
      test_run_id: 'PHASE10_SYNTHETIC',
    }, over);
  };

  // A. Deterministic ordering cohort: 55 priced, eligible WTS rows with
  //    strictly decreasing prices -> forces 2 pages at pageSize=50 and an
  //    exact expected ordering (priced_rank=1, image_rank=1, price DESC).
  const orderingRows = [];
  for (let k = 0; k < 55; k++) {
    const price = 90000 - k * 137; // strictly decreasing, all distinct
    const row = mk({
      listing_id: `P10SYN-ORD-${String(k).padStart(3, '0')}`,
      price_usd: price,
      original_price_amount: price,
      original_price_text: `USD ${price}`,
      price_research_eligible: true,
      included_in_statistics: false,
      statistics_exclusion_reason: 'SYNTHETIC_ORDERING_FIXTURE',
    });
    rows.push(row);
    orderingRows.push({ listing_id: row.listing_id, price_usd: price });
  }

  // B. Ineligible-but-priced boundary row (Phase 5 F-A regression):
  //    price set but price_research_eligible=false -> priced_rank=2, must
  //    sort after ALL eligible rows without crashing cursor traversal.
  const boundaryRow = mk({
    listing_id: 'P10SYN-BOUNDARY',
    price_usd: 999999,
    original_price_amount: 999999,
    original_price_text: 'USD 999999',
    price_research_eligible: false,
  });
  rows.push(boundaryRow);

  // C. Unpriced row (NULLS LAST tail).
  rows.push(mk({ listing_id: 'P10SYN-UNPRICED', price_usd: null, original_price_amount: null, original_price_text: null, price_status: 'NO_PRICE' }));

  // D. Bundle parent with two published children (Phase 6 suppression).
  rows.push(mk({
    listing_id: 'P10SYN-BUNDLE-PARENT',
    is_bundle: true,
    bundle_child_count: 2,
    price_usd: 150000,
    original_price_amount: 150000,
    original_price_text: 'USD 150000',
    price_research_eligible: true,
    reference: 'SYN-BUNDLE',
  }));
  rows.push(mk({
    listing_id: 'P10SYN-BUNDLE-CHILD-1',
    parent_listing_id: 'P10SYN-BUNDLE-PARENT',
    child_index: 1,
    price_usd: 80000,
    original_price_amount: 80000,
    original_price_text: 'USD 80000',
    price_research_eligible: true,
    reference: 'SYN-BUNDLE-C1',
  }));
  rows.push(mk({
    listing_id: 'P10SYN-BUNDLE-CHILD-2',
    parent_listing_id: 'P10SYN-BUNDLE-PARENT',
    child_index: 2,
    price_usd: 70000,
    original_price_amount: 70000,
    original_price_text: 'USD 70000',
    price_research_eligible: true,
    reference: 'SYN-BUNDLE-C2',
  }));

  // E. Price Research cohort: Patek Philippe 7128/1G, Blue dial, New.
  //    Qualified WTS observations after dedup: 98000, 100000, 102000.
  //    Expected: count=3 median=100000 q1=99000 q3=101000 iqr=2000
  //    lower_fence=93000 upper_fence=107000 avg=100000 min=98000 max=102000.
  const cohortBase = {
    brand: 'Patek Philippe',
    reference: '7128/1G',
    model: 'Nautilus',
    dial_color: 'Blue',
    condition: 'New',
    intent: 'WTS',
    price_research_eligible: true,
    included_in_statistics: true,
    statistics_exclusion_reason: null,
  };
  const cohortPrices = [98000, 100000, 102000];
  cohortPrices.forEach((price, idx) => {
    rows.push(mk(Object.assign({}, cohortBase, {
      listing_id: `P10SYN-PR-COHORT-${idx + 1}`,
      seller_id: `SYN-PR-SELLER-${idx + 1}`,
      seller_display_name: `Synthetic PR Seller ${idx + 1}`,
      price_usd: price,
      original_price_amount: price,
      original_price_text: `USD ${price}`,
    })));
  });
  // E2. Duplicate/repost: same seller, same cohort, same price as cohort row 1.
  //     Distinct listing_id, no duplicate_group_id -> hash fallback group_key
  //     collides with cohort row 1 and must be deduplicated out of stats.
  rows.push(mk(Object.assign({}, cohortBase, {
    listing_id: 'P10SYN-PR-REPOST',
    seller_id: 'SYN-PR-SELLER-1',
    seller_display_name: 'Synthetic PR Seller 1',
    price_usd: 98000,
    original_price_amount: 98000,
    original_price_text: 'USD 98000',
  })));
  // E3. Same cohort but WTB intent: must be excluded from stats and from the
  //     price_research_ready_view_v2 WTS surface entirely.
  rows.push(mk(Object.assign({}, cohortBase, {
    listing_id: 'P10SYN-PR-WTB',
    intent: 'WTB',
    price_usd: 95000,
    original_price_amount: 95000,
    original_price_text: 'USD 95000',
    included_in_statistics: false,
  })));
  // E4. Same cohort but excluded from statistics by flag.
  rows.push(mk(Object.assign({}, cohortBase, {
    listing_id: 'P10SYN-PR-EXCLUDED',
    price_usd: 500000,
    original_price_amount: 500000,
    original_price_text: 'USD 500000',
    included_in_statistics: false,
    statistics_exclusion_reason: 'SYNTHETIC_EXCLUDED_FIXTURE',
  })));

  // F. Unresolved cohort: exactly one qualified observation.
  //    Stats must be null and the UI must render the developing-stats notice
  //    without fabricating numbers.
  rows.push(mk({
    listing_id: 'P10SYN-PR-SINGLETON',
    brand: 'Rolex',
    reference: '16610LV',
    model: 'Submariner',
    dial_color: 'Green',
    condition: 'Excellent',
    intent: 'WTS',
    price_research_eligible: true,
    included_in_statistics: true,
    price_usd: 14500,
    original_price_amount: 14500,
    original_price_text: 'USD 14500',
  }));

  return {
    rows,
    expected: {
      orderingListingIds: orderingRows.map(r => r.listing_id), // expected DOM/traversal order prefix
      boundaryId: 'P10SYN-BOUNDARY',
      unpricedId: 'P10SYN-UNPRICED',
      bundleParentId: 'P10SYN-BUNDLE-PARENT',
      bundleChildIds: ['P10SYN-BUNDLE-CHILD-1', 'P10SYN-BUNDLE-CHILD-2'],
      cohort: {
        brand: 'Patek Philippe',
        reference: '7128/1G',
        model: 'Nautilus',
        dial_color: 'Blue',
        condition: 'New',
        qualified_prices: [98000, 100000, 102000],
        qualified_count: 3,
        median: 100000,
        q1: 99000,
        q3: 101000,
        iqr: 2000,
        lower_fence: 93000,
        upper_fence: 107000,
        avg: 100000,
        min: 98000,
        max: 102000,
      },
      wtbId: 'P10SYN-PR-WTB',
      excludedId: 'P10SYN-PR-EXCLUDED',
      repostId: 'P10SYN-PR-REPOST',
      unresolved: { brand: 'Rolex', reference: '16610LV', dial_color: 'Green', condition: 'Excellent' },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Seeder
 * ------------------------------------------------------------------ */
async function seedFixtures(pgClient, rows, imageBaseUrl) {
  const cols = [
    'contract_version', 'listing_id', 'parent_listing_id', 'child_index', 'source_id', 'source_hash',
    'raw_message_id', 'raw_message_text', 'source_context_text', 'source_created_at', 'observed_at',
    'category', 'brand', 'model', 'reference', 'dial_color', 'year', 'condition', 'intent', 'intent_status',
    'title', 'description', 'original_price_text', 'original_price_amount', 'original_price_currency',
    'price_usd', 'fx_rate', 'fx_source', 'fx_date', 'price_status', 'price_research_eligible',
    'included_in_statistics', 'statistics_exclusion_reason', 'image_url', 'thumbnail_url', 'image_key',
    'image_evidence_type', 'image_status', 'seller_id', 'seller_display_name', 'seller_profile_url',
    'seller_review_count', 'seller_listing_count', 'seller_wts_count', 'seller_wtb_count',
    'contact_available', 'location_country', 'location_region', 'is_bundle', 'bundle_child_count',
    'duplicate_group_id', 'review_status', 'review_reasons', 'test_run_id',
  ];
  for (const row of rows) {
    const r = Object.assign({}, row);
    const values = cols.map(c => r[c] === undefined ? null : r[c]);
    const placeholders = cols.map((c, idx) => `$${idx + 1}`).join(', ');
    await pgClient.query(
      `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2 (${cols.join(', ')}) VALUES (${placeholders})`,
      values.map(v => (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) ? JSON.stringify(v) : v)
    );
  }
}

/* ------------------------------------------------------------------ *
 * PostgREST-RPC shim: POST /rpc/<fn> with a JSON object body executes
 * the real PostgreSQL function (named-argument call, types introspected
 * from pg_proc) against the disposable embedded instance.
 * ------------------------------------------------------------------ */
async function loadProcCatalog(pgClient) {
  // Discover input parameters per function via information_schema (reliably
  // aligned, unlike pg_proc array cross-indexing) and proretset via pg_proc.
  const { rows: procs } = await pgClient.query(`
    SELECT p.proname AS name, p.proretset AS retset, p.oid AS oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  `);
  const { rows: params } = await pgClient.query(`
    SELECT specific_name, parameter_name, parameter_mode, udt_name, ordinal_position
    FROM information_schema.parameters
    WHERE specific_schema = 'public'
    ORDER BY specific_name, ordinal_position
  `);
  const TYPE_MAP = {
    text: 'text', varchar: 'text', bool: 'boolean', int4: 'integer', int8: 'bigint',
    int2: 'smallint', numeric: 'numeric', float8: 'double precision', float4: 'real',
    timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
    date: 'date', uuid: 'uuid', jsonb: 'jsonb', json: 'json', _text: 'text[]',
  };
  const bySpecific = new Map();
  for (const p of params) {
    if (!bySpecific.has(p.specific_name)) bySpecific.set(p.specific_name, []);
    bySpecific.get(p.specific_name).push(p);
  }
  const catalog = new Map();
  for (const proc of procs) {
    // Match parameters rows belonging to this exact function (specific_name = name_oid).
    const specific = `${proc.name}_${proc.oid}`;
    const args = (bySpecific.get(specific) || [])
      .filter(p => p.parameter_mode === 'IN' || p.parameter_mode === 'INOUT')
      .map(p => ({ name: p.parameter_name, type: TYPE_MAP[p.udt_name] || p.udt_name }));
    catalog.set(proc.name, { name: proc.name, retset: proc.retset, args });
  }
  return catalog;
}

function makeRpcHandler(pgClient, procCatalog) {
  return async function handleRpc(fnName, body) {
    const proc = procCatalog.get(fnName);
    if (!proc) {
      const err = new Error(`function public.${fnName} does not exist`);
      err.httpStatus = 404;
      throw err;
    }
    const inputArgs = (proc.args || []).filter(a => Object.prototype.hasOwnProperty.call(body || {}, a.name));
    const values = [];
    const callParts = [];
    inputArgs.forEach((a, idx) => {
      values.push(body[a.name]);
      callParts.push(`"${a.name}" => $${idx + 1}::${a.type}`);
    });
    let sql;
    if (proc.retset) {
      sql = `SELECT * FROM public."${fnName}"(${callParts.join(', ')})`;
    } else {
      sql = `SELECT public."${fnName}"(${callParts.join(', ')}) AS value`;
    }
    const result = await pgClient.query(sql, values);
    if (proc.retset) return result.rows;
    return result.rows.length ? result.rows[0].value : null;
  };
}

/* ------------------------------------------------------------------ *
 * Local application server: static dist/ + real canary API handlers +
 * RPC shim + synthetic image host + benign stubs for unrelated legacy
 * endpoints the page probes (so the console stays error-free; these are
 * never asserted on).
 * ------------------------------------------------------------------ */
function makeAppServer({ distDir, handleRpc }) {
  const tradingFloorHandler = require('../../api/canary/trading-floor');
  const priceResearchHandler = require('../../api/canary/price-research');

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
  };

  function sendJson(res, code, obj) {
    const text = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(text);
  }

  // Benign empty payloads keyed by what each legacy consumer expects.
  function benignPayload(pathname) {
    if (pathname.includes('catalog-suggestions')) return { suggestions: [] };
    if (pathname.includes('catalog-models')) return { models: [] };
    if (pathname.includes('catalog-references')) return { references: [] };
    if (pathname.includes('reviewed-market-inventory')) return { status: 'ok', records: [], total: 0, hasMore: false };
    if (pathname.includes('live-release-summary')) return { status: 'ok', releases: [] };
    if (pathname.includes('model-stats')) return { status: 'ok', stats: null };
    if (pathname.includes('reviewed-seller-summary')) return { status: 'ok', seller: null };
    if (pathname.includes('listing-contact')) return { status: 'unavailable', contact: null };
    if (pathname.includes('price-research-listing')) return { status: 'ok', listing: null };
    return { status: 'ok' };
  }

  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      // RPC shim (supabase-js with USE_DIRECT_POSTGREST rewrites /rest/v1/* -> /*)
      if (req.method === 'POST' && pathname.startsWith('/rpc/')) {
        const fnName = decodeURIComponent(pathname.slice('/rpc/'.length));
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', async () => {
          try {
            const body = raw ? JSON.parse(raw) : {};
            const data = await handleRpc(fnName, body);
            sendJson(res, 200, data === undefined ? null : data);
          } catch (err) {
            sendJson(res, err.httpStatus || 400, { message: err.message, code: err.code || 'PGRST', details: null, hint: null });
          }
        });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
        res.end();
        return;
      }

      // Real canary API handlers (req/res micro-shim, same pattern as
      // tests/canary-http-integration.test.cjs).
      if (pathname === '/api/canary/trading-floor' || pathname === '/api/canary/price-research') {
        req.query = Object.fromEntries(parsedUrl.searchParams);
        res.status = function (code) { this.statusCode = code; return this; };
        res.json = function (data) { sendJson(this, this.statusCode || 200, data); };
        const handler = pathname.endsWith('trading-floor') ? tradingFloorHandler : priceResearchHandler;
        await handler(req, res);
        return;
      }

      // Synthetic loopback image host.
      if (pathname.startsWith('/img/')) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(PNG_1PX);
        return;
      }

      // Benign stubs for unrelated legacy endpoints the pages probe.
      if (pathname.startsWith('/api/')) {
        sendJson(res, 200, benignPayload(pathname));
        return;
      }

      // Static dist/ with SPA fallback.
      let filePath = path.join(distDir, decodeURIComponent(pathname));
      if (!filePath.startsWith(distDir)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      try { sendJson(res, 500, { status: 'error', message: String(err && err.message || err) }); }
      catch { try { res.end(); } catch {} }
    }
  });
}

/* ------------------------------------------------------------------ *
 * Expected-order oracle: DB-side computation of the exact keyset order.
 * ------------------------------------------------------------------ */
async function computeExpectedFloorOrder(pgClient) {
  const { rows } = await pgClient.query(`
    SELECT listing_id, price_usd::float8 AS price_usd
    FROM public.trading_floor_ready_view_v2
    ORDER BY
      (CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END) ASC,
      (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END) ASC,
      price_usd DESC NULLS LAST,
      source_created_at DESC,
      listing_id ASC
  `);
  return rows.map(r => r.listing_id);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const args = process.argv.slice(2);
  const argVal = (name, dflt) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : dflt;
  };
  const outDir = path.resolve(argVal('--out-dir', path.join(process.cwd(), 'audit-output', 'canary-e2e')));
  const resultsPath = path.resolve(argVal('--results', path.join(outDir, 'results.json')));
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotsDir = path.join(outDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const ledger = new AssertionLedger();
  const startedAt = new Date().toISOString();
  console.log(`[phase10] disposable canary E2E starting at ${startedAt}`);

  assertDisposableEnvironment();
  console.log('[phase10] environment guard passed (no production identifiers present)');

  const repoRoot = path.resolve(__dirname, '..', '..');
  const distDir = path.join(repoRoot, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('DIST_MISSING: run `npm run build` first; refusing to serve a stale/absent frontend.');
  }

  // 1. Disposable embedded Postgres
  const dependencyRequire = require('./test-dependencies.cjs');
  const EmbeddedPostgresMod = dependencyRequire('embedded-postgres');
  const EmbeddedPostgres = EmbeddedPostgresMod.default || EmbeddedPostgresMod;
  const pgPort = await getFreePort();
  const pgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10_epg_'));
  const epg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  });
  console.log('[phase10] initialising embedded postgres...');
  await epg.initialise();
  await epg.start();
  console.log(`[phase10] embedded postgres listening on 127.0.0.1:${pgPort}`);

  const { Client, types } = dependencyRequire('pg');
  // Match PostgREST wire semantics: numerics as JSON numbers, int8 as numbers.
  types.setTypeParser(20, v => (v === null ? null : Number(v)));
  types.setTypeParser(1700, v => (v === null ? null : Number(v)));
  const pgClient = new Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: 'postgres', database: 'postgres' });
  await pgClient.connect();

  let exitCode = 0;
  let browser = null;
  let appServer = null;
  const screenshots = [];

  try {
    // 2. Migrations
    for (const mig of CANARY_MIGRATIONS) {
      const sql = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', mig), 'utf8');
      await pgClient.query(sql);
      console.log(`[phase10] migration applied: ${mig}`);
    }
    await ledger.check('MIGRATIONS_APPLIED', 'database', async () => {
      const { rows } = await pgClient.query(`
        SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
          'get_trading_floor_canary_keyset_v4','get_trading_floor_canary_count',
          'get_price_research_canary_keyset_v4','get_price_research_scoped_stats_v2',
          'open_trading_floor_keyset_snapshot','open_price_research_keyset_snapshot',
          'get_price_research_wtb_demand_v3')`);
      if (rows[0].n !== 7) throw new Error(`expected 7 canary RPCs, found ${rows[0].n}`);
      return { migrations: CANARY_MIGRATIONS.length, rpc_count: rows[0].n };
    });

    // 3. Fixtures
    const appPort = await getFreePort();
    const imageBaseUrl = `http://127.0.0.1:${appPort}`;
    const fixtures = buildFixtures();
    await seedFixtures(pgClient, fixtures.rows, imageBaseUrl);
    await ledger.check('FIXTURES_SEEDED', 'database', async () => {
      const { rows } = await pgClient.query(
        `SELECT count(*)::int AS n FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE test_run_id = 'PHASE10_SYNTHETIC'`);
      assertEq(rows[0].n, fixtures.rows.length, 'seeded row count');
      return { seeded_rows: rows[0].n, synthetic_only: true, test_run_id: 'PHASE10_SYNTHETIC' };
    });

    // 4. App server with real handlers wired to embedded PG via RPC shim.
    process.env.USE_DIRECT_POSTGREST = 'true';
    process.env.SUPABASE_URL = `http://127.0.0.1:${appPort}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'phase10-synthetic-loopback-key';
    delete process.env.VITE_SUPABASE_URL;
    const procCatalog = await loadProcCatalog(pgClient);
    const handleRpc = makeRpcHandler(pgClient, procCatalog);
    appServer = makeAppServer({ distDir, handleRpc });
    await new Promise((resolve) => appServer.listen(appPort, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${appPort}`;
    console.log(`[phase10] app server listening on ${baseUrl}`);

    // Sanity: direct API roundtrip through the real handler.
    await ledger.check('API_TRADING_FLOOR_FIRST_PAGE', 'api', async () => {
      const resp = await fetch(`${baseUrl}/api/canary/trading-floor?pageSize=50&pagination=cursor`);
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      const body = await resp.json();
      if (body.status !== 'ok') throw new Error(`status=${body.status}`);
      if (!Array.isArray(body.records) || body.records.length !== 50) throw new Error(`expected 50 records, got ${body.records && body.records.length}`);
      if (!body.nextCursor) throw new Error('expected nextCursor for page 2');
      return { records: body.records.length, total: body.total, has_more: body.hasMore };
    });

    // 5. API-level full keyset traversal (drives the browser assertions'
    //    oracle and independently validates cursor semantics).
    const expectedFloorOrder = await computeExpectedFloorOrder(pgClient);
    const traversedIds = [];
    let traversalOk = true;
    let traversalError = null;
    let pageCount = 0;
    try {
      let cursor = null;
      const seen = new Set();
      do {
        pageCount += 1;
        if (pageCount > 20) throw new Error('traversal did not terminate within 20 pages');
        const u = `${baseUrl}/api/canary/trading-floor?pageSize=50&pagination=cursor${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const resp = await fetch(u);
        if (resp.status !== 200) throw new Error(`page ${pageCount}: HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        const body = await resp.json();
        if (body.status !== 'ok') throw new Error(`page ${pageCount}: status=${body.status}`);
        for (const rec of body.records) {
          if (seen.has(rec.listing_id)) throw new Error(`duplicate listing_id across pages: ${rec.listing_id}`);
          seen.add(rec.listing_id);
          traversedIds.push(rec.listing_id);
        }
        cursor = body.nextCursor || null;
        if (!cursor && body.hasMore) throw new Error('hasMore=true but nextCursor is null');
      } while (cursor);
    } catch (err) {
      traversalOk = false;
      traversalError = String(err.message || err);
    }
    await ledger.check('API_KEYSET_TRAVERSAL_NO_DUPLICATES', 'api', async () => {
      if (!traversalOk) throw new Error(traversalError);
      return { pages: pageCount, unique_listings: traversedIds.length };
    });
    await ledger.check('API_KEYSET_ORDER_MATCHES_DB', 'api', async () => {
      assertEq(traversedIds, expectedFloorOrder, 'traversed order vs DB keyset order');
      return { compared: traversedIds.length };
    });
    await ledger.check('API_BOUNDARY_ROW_RANKED_LAST_OF_PRICED', 'api', async () => {
      const idxBoundary = traversedIds.indexOf(fixtures.expected.boundaryId);
      const idxUnpriced = traversedIds.indexOf(fixtures.expected.unpricedId);
      const lastEligibleIdx = traversedIds.indexOf(fixtures.expected.cohort ? 'P10SYN-PR-COHORT-1' : ''); // lowest-priced eligible fixture
      if (idxBoundary < 0) throw new Error('boundary row missing from traversal');
      if (idxUnpriced < 0) throw new Error('unpriced row missing from traversal');
      // Boundary (ineligible, priced) must sort after every priced_rank=1 row.
      const eligibleTail = 'P10SYN-ORD-054'; // lowest priced eligible ordering row
      const idxTail = traversedIds.indexOf(eligibleTail);
      if (!(idxTail >= 0 && idxBoundary > idxTail)) {
        throw new Error(`boundary row at index ${idxBoundary} did not sort after last eligible row at ${idxTail}`);
      }
      if (!(idxUnpriced > idxBoundary)) throw new Error('unpriced row must follow priced boundary row');
      return { boundary_index: idxBoundary, unpriced_index: idxUnpriced, last_eligible_index: Math.max(idxTail, lastEligibleIdx) };
    });
    await ledger.check('API_BUNDLE_PARENT_SUPPRESSED', 'api', async () => {
      if (traversedIds.includes(fixtures.expected.bundleParentId)) {
        throw new Error('bundle parent with published children rendered on trading floor');
      }
      for (const child of fixtures.expected.bundleChildIds) {
        if (!traversedIds.includes(child)) throw new Error(`published bundle child ${child} missing from trading floor`);
      }
      return { suppressed_parent: fixtures.expected.bundleParentId, children_present: fixtures.expected.bundleChildIds };
    });

    // Price Research API-level cohort verification.
    const cohort = fixtures.expected.cohort;
    await ledger.check('API_PRICE_RESEARCH_STATS_MATCH_FIXTURE', 'api', async () => {
      const u = `${baseUrl}/api/canary/price-research?brand=${encodeURIComponent(cohort.brand)}&reference=${encodeURIComponent(cohort.reference)}&dial=${encodeURIComponent(cohort.dial_color)}&condition=${encodeURIComponent(cohort.condition)}&pageSize=100`;
      const resp = await fetch(u);
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      if (!body.success) throw new Error(`success=${body.success}: ${body.error || ''}`);
      if (!body.stats) throw new Error('stats missing for resolvable cohort');
      assertEq(Number(body.stats.qualified_count), cohort.qualified_count, 'qualified_count (repost must dedupe)');
      assertEq(Number(body.stats.median), cohort.median, 'median');
      assertEq(Number(body.stats.q1), cohort.q1, 'q1');
      assertEq(Number(body.stats.q3), cohort.q3, 'q3');
      assertEq(Number(body.stats.iqr), cohort.iqr, 'iqr');
      assertEq(Number(body.stats.lower_fence), cohort.lower_fence, 'lower_fence');
      assertEq(Number(body.stats.upper_fence), cohort.upper_fence, 'upper_fence');
      return { stats: body.stats };
    });
    await ledger.check('API_PRICE_RESEARCH_STATS_MATCH_DB_DIRECT', 'api', async () => {
      const { rows } = await pgClient.query(
        `SELECT * FROM public.get_price_research_scoped_stats_v2($1, $2, $3, $4, $5)`,
        [cohort.brand, cohort.reference, cohort.model, cohort.dial_color, cohort.condition]);
      if (!rows.length) throw new Error('DB stats function returned no rows');
      const s = rows[0];
      assertEq(Number(s.qualified_count), cohort.qualified_count, 'db qualified_count');
      assertEq(Number(s.median_price), cohort.median, 'db median');
      assertEq(Number(s.q1_price), cohort.q1, 'db q1');
      assertEq(Number(s.q3_price), cohort.q3, 'db q3');
      assertEq(Number(s.iqr), cohort.iqr, 'db iqr');
      assertEq(Number(s.iqr_multiplier), 3.0, 'db iqr multiplier');
      return { db_stats: s };
    });
    await ledger.check('API_PRICE_RESEARCH_WTB_EXCLUDED', 'api', async () => {
      const u = `${baseUrl}/api/canary/price-research?brand=${encodeURIComponent(cohort.brand)}&reference=${encodeURIComponent(cohort.reference)}&dial=${encodeURIComponent(cohort.dial_color)}&condition=${encodeURIComponent(cohort.condition)}&pageSize=100`;
      const body = await (await fetch(u)).json();
      const evidence = ((body.evidence && body.evidence.listings) || body.listings || []);
      const ids = evidence.map(r => r.listing_id || r.id);
      if (ids.includes(fixtures.expected.wtbId)) throw new Error('WTB row leaked into WTS evidence surface');
      return { evidence_rows: ids.length, wtb_absent: true };
    });
    await ledger.check('API_PRICE_RESEARCH_UNRESOLVED_COHORT', 'api', async () => {
      const un = fixtures.expected.unresolved;
      const u = `${baseUrl}/api/canary/price-research?brand=${encodeURIComponent(un.brand)}&reference=${encodeURIComponent(un.reference)}&dial=${encodeURIComponent(un.dial_color)}&condition=${encodeURIComponent(un.condition)}&pageSize=100`;
      const body = await (await fetch(u)).json();
      if (body.stats) throw new Error(`unresolved cohort fabricated stats: ${JSON.stringify(body.stats)}`);
      if (!body.stats_explanation) throw new Error('missing stats_explanation for unresolved cohort');
      return { stats: null, explanation: body.stats_explanation };
    });

    // Fail-closed provenance proof: a provenance-less row must hard-fail the
    // surface (HTTP 500), never silently render. Executed against a fresh
    // snapshot, then the poisonous row is removed.
    await ledger.check('API_FAIL_CLOSED_ON_PROVENANCELESS_ROW', 'api', async () => {
      await pgClient.query(
        `INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2
           (listing_id, source_id, source_hash, raw_message_id, source_created_at, observed_at, intent,
            price_usd, original_price_amount, original_price_currency, price_research_eligible,
            image_status, image_key, image_url, image_evidence_type, test_run_id)
         VALUES ('P10SYN-POISON', 'SYN-SRC-POISON', 'deadbeef', 'SYN-MSG-POISON', now(), now(), 'WTS',
            999999999, 999999999, 'USD', true,
            'SOURCE_IMAGE_PRESENT', 'syn-poison', $1, 'SOURCE_LINKED_IMAGE', 'PHASE10_SYNTHETIC')`,
        [`${baseUrl}/img/syn-poison.png`]);
      try {
        const resp = await fetch(`${baseUrl}/api/canary/trading-floor?pageSize=50&pagination=cursor`);
        if (resp.status === 200) throw new Error('provenance-less row did NOT fail closed (HTTP 200)');
        if (resp.status !== 500) throw new Error(`unexpected status ${resp.status}`);
        const body = await resp.json();
        return { http_status: resp.status, fail_closed: true, surface_message: typeof body.message === 'string' ? body.message.slice(0, 80) : null };
      } finally {
        await pgClient.query(`DELETE FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id = 'P10SYN-POISON'`);
      }
    });

    // 6. Real browser execution.
    browser = new CdpBrowserSession(resolveBrowserBin());
    await browser.launch();
    console.log('[phase10] chromium launched via CDP');

    // --- Trading Floor ---
    await browser.navigate(`${baseUrl}/#/trading`);
    await browser.waitForState(`Boolean(document.querySelector('#root'))`, 20000);
    await browser.waitForState(`Boolean(document.querySelector('article[data-listing-id]'))`, 30000);
    await browser.waitForState(`!document.body.innerText.includes('Loading')`, 30000).catch(() => {});

    await ledger.check('BROWSER_TF_PAGE_RENDERS', 'browser_trading_floor', async () => {
      const count = await browser.evaluate(`document.querySelectorAll('article[data-listing-id]').length`);
      if (!count || count < 1) throw new Error('no listing cards rendered');
      return { cards_on_first_page: count };
    });

    // Full browser-driven cursor traversal: click "Next" until exhausted,
    // collecting rendered data-listing-id order per page.
    const browserPages = [];
    const browserOrder = [];
    let browserTraversalError = null;
    try {
      for (let page = 0; page < 10; page++) {
        await browser.waitForState(
          `Array.from(document.querySelectorAll('article[data-listing-id]')).every(el => el.getAttribute('data-listing-id'))`,
          20000);
        const ids = await browser.evaluate(
          `Array.from(document.querySelectorAll('article[data-listing-id]')).map(el => el.getAttribute('data-listing-id'))`);
        browserPages.push(ids);
        browserOrder.push(...ids);
        const clicked = await browser.evaluate(`(function() {
          var btns = Array.from(document.querySelectorAll('nav[aria-label="Trading Floor pages"] button, button'));
          var next = btns.find(b => b.textContent.trim() === 'Next' && !b.disabled);
          if (!next) return false;
          next.click();
          return true;
        })()`);
        if (!clicked) break;
        const firstId = ids[0];
        await browser.waitForState(
          `(function(){ var el = document.querySelector('article[data-listing-id]'); return el && el.getAttribute('data-listing-id') !== ${JSON.stringify(firstId)}; })()`,
          20000);
      }
    } catch (err) {
      browserTraversalError = String(err.message || err);
    }
    const tfShot = path.join(screenshotsDir, 'trading-floor.png');
    await browser.captureScreenshot(tfShot);
    screenshots.push(tfShot);

    await ledger.check('BROWSER_TF_TRAVERSAL_TERMINATES', 'browser_trading_floor', async () => {
      if (browserTraversalError) throw new Error(browserTraversalError);
      if (browserPages.length < 2) throw new Error(`expected multi-page traversal, got ${browserPages.length} page(s)`);
      return { pages: browserPages.length };
    });
    await ledger.check('BROWSER_TF_ZERO_DUPLICATE_IDS', 'browser_trading_floor', async () => {
      const dupes = browserOrder.filter((id, idx) => browserOrder.indexOf(id) !== idx);
      if (dupes.length) throw new Error(`duplicate listing_ids rendered across pages: ${[...new Set(dupes)].join(',')}`);
      return { total_rendered: browserOrder.length };
    });
    await ledger.check('BROWSER_TF_ORDER_MATCHES_DB', 'browser_trading_floor', async () => {
      assertEq(browserOrder, expectedFloorOrder, 'browser-rendered order vs DB keyset order');
      return { compared: browserOrder.length, priced_wts_first: true, descending_price: true };
    });
    await ledger.check('BROWSER_TF_BOUNDARY_ROW_TRAVERSAL_SAFE', 'browser_trading_floor', async () => {
      const idx = browserOrder.indexOf(fixtures.expected.boundaryId);
      if (idx < 0) throw new Error('ineligible-priced boundary row never rendered');
      const tailIdx = browserOrder.indexOf('P10SYN-ORD-054');
      if (!(tailIdx >= 0 && idx > tailIdx)) throw new Error('boundary row did not sort after eligible rows');
      return { boundary_index: idx, boundary_rendered_without_crash: true };
    });
    await ledger.check('BROWSER_TF_BUNDLE_PARENT_SUPPRESSED', 'browser_trading_floor', async () => {
      if (browserOrder.includes(fixtures.expected.bundleParentId)) throw new Error('bundle parent rendered');
      for (const c of fixtures.expected.bundleChildIds) {
        if (!browserOrder.includes(c)) throw new Error(`bundle child ${c} missing`);
      }
      return { parent_absent: true, children_present: fixtures.expected.bundleChildIds };
    });
    await ledger.check('BROWSER_TF_NO_PROVENANCELESS_CARD', 'browser_trading_floor', async () => {
      const bad = await browser.evaluate(`(function() {
        return Array.from(document.querySelectorAll('article[data-listing-id]'))
          .map(el => el.getAttribute('data-listing-id'))
          .filter(id => !id || id === 'undefined' || id === 'null' || id === '');
      })()`);
      if (bad && bad.length) throw new Error(`cards rendered without provenance identity: ${bad.length}`);
      return { cards_checked: 'all_rendered', fail_closed_contract: true };
    });

    // --- Price Research (resolved cohort) ---
    // Full document load (cache-busting query) so the route mounts fresh.
    // Deep link carries the exact cohort (brand, reference, dial, condition).
    await browser.navigate(`${baseUrl}/?nav=pr1#/price-research?brand=${encodeURIComponent(cohort.brand)}&ref=${encodeURIComponent(cohort.reference)}&dial=${encodeURIComponent(cohort.dial_color)}&condition=${encodeURIComponent(cohort.condition)}`);
    await browser.waitForState(`Boolean(document.querySelector('#root'))`, 20000);
    // Wait for the cohort stats block (Median price label) or give the UI time.
    const statsRendered = await browser.waitForState(
      `document.body.innerText.includes('Median price')`, 40000).then(() => true).catch(() => false);
    const prShot = path.join(screenshotsDir, 'price-research-cohort.png');
    await browser.captureScreenshot(prShot);
    screenshots.push(prShot);

    await ledger.check('BROWSER_PR_PAGE_RENDERS_COHORT', 'browser_price_research', async () => {
      if (!statsRendered) throw new Error('median stats block did not render for exact-cohort deep link');
      const text = await browser.evaluate(`document.body.innerText`);
      if (!text.includes(cohort.reference)) throw new Error('cohort reference not rendered');
      return { cohort: `${cohort.brand} ${cohort.reference}`, deep_link: 'brand+ref+dial+condition' };
    });

    if (statsRendered) {
      await ledger.check('BROWSER_PR_RENDERED_STATS_MATCH_DB', 'browser_price_research', async () => {
        const { rows } = await pgClient.query(
          `SELECT * FROM public.get_price_research_scoped_stats_v2($1, $2, $3, $4, $5)`,
          [cohort.brand, cohort.reference, cohort.model, cohort.dial_color, cohort.condition]);
        const s = rows[0];
        const rendered = await browser.evaluate(`(function() {
          var text = document.body.innerText;
          function grab(label) {
            var m = text.match(new RegExp(label + '[^0-9$]*\\\\$([0-9,]+)'));
            return m ? Number(m[1].replace(/,/g, '')) : null;
          }
          return { median: grab('Median price'), q1: grab('Q1'), q3: grab('Q3') };
        })()`);
        if (rendered.median === null) throw new Error('rendered median not found in DOM');
        const within = (a, b) => Math.abs(Number(a) - Number(b)) <= 1; // rounding tolerance
        if (!within(rendered.median, s.median_price)) throw new Error(`rendered median ${rendered.median} != DB ${s.median_price}`);
        if (rendered.q1 !== null && !within(rendered.q1, s.q1_price)) throw new Error(`rendered q1 ${rendered.q1} != DB ${s.q1_price}`);
        if (rendered.q3 !== null && !within(rendered.q3, s.q3_price)) throw new Error(`rendered q3 ${rendered.q3} != DB ${s.q3_price}`);
        if (!within(rendered.median, cohort.median)) throw new Error(`rendered median ${rendered.median} != fixture ${cohort.median}`);
        return { rendered, db: { median: Number(s.median_price), q1: Number(s.q1_price), q3: Number(s.q3_price) }, fixture: { median: cohort.median, q1: cohort.q1, q3: cohort.q3 }, iqr_multiplier: 3.0 };
      });
    } else {
      ledger.notRun('BROWSER_PR_RENDERED_STATS_MATCH_DB', 'browser_price_research', 'stats block never rendered; see BROWSER_PR_PAGE_RENDERS_COHORT failure');
    }

    // --- Price Research (unresolved cohort: singleton observation) ---
    const un = fixtures.expected.unresolved;
    await browser.navigate(`${baseUrl}/?nav=pr2#/price-research?brand=${encodeURIComponent(un.brand)}&ref=${encodeURIComponent(un.reference)}&dial=${encodeURIComponent(un.dial_color)}&condition=${encodeURIComponent(un.condition)}`);
    await browser.waitForState(`Boolean(document.querySelector('#root'))`, 20000);
    await new Promise(r => setTimeout(r, 4000));
    const unShot = path.join(screenshotsDir, 'price-research-unresolved.png');
    await browser.captureScreenshot(unShot);
    screenshots.push(unShot);
    await ledger.check('BROWSER_PR_UNRESOLVED_NO_FABRICATED_STATS', 'browser_price_research', async () => {
      const info = await browser.evaluate(`(function() {
        var text = document.body.innerText;
        var hasNotice = /unresolved|developing|Fewer than 2|Select an exact/i.test(text);
        var hasMedian = /Median price[^0-9$]*\\$[0-9]/.test(text);
        return { hasNotice, hasMedian };
      })()`);
      if (info.hasMedian) throw new Error('unresolved cohort rendered fabricated median stats');
      if (!info.hasNotice) throw new Error('no developing/unresolved stats notice rendered');
      return info;
    });

    // Zero console / network errors across the whole browser session.
    await ledger.check('BROWSER_ZERO_CONSOLE_ERRORS', 'browser', async () => {
      if (browser.consoleErrors.length) throw new Error(`${browser.consoleErrors.length} console errors: ${browser.consoleErrors.slice(0, 5).join(' | ')}`);
      return { console_errors: 0 };
    });
    await ledger.check('BROWSER_ZERO_NETWORK_ERRORS', 'browser', async () => {
      if (browser.networkErrors.length) throw new Error(`${browser.networkErrors.length} network errors: ${JSON.stringify(browser.networkErrors.slice(0, 5))}`);
      return { network_errors: 0 };
    });

    // listing-contact handler: requires PostgREST table-query emulation
    // (.from(...).select(...) chains), which this rpc-only shim deliberately
    // does not fake. Recorded honestly as NOT_RUN.
    ledger.notRun('API_LISTING_CONTACT', 'api', 'listing-contact.js uses PostgREST table queries (.from/.select/.eq); rpc-only loopback shim does not emulate them and faking them would violate the no-fabrication rule.');
    ledger.notRun('VERCEL_PREVIEW', 'deployment', 'BLOCKED_NO_CREDENTIALS: no Vercel/Railway credentials authorized this session; external connections forbidden by safety policy.');
  } catch (err) {
    console.error('[phase10] FATAL:', err && err.stack || err);
    ledger.fail('RUNNER_FATAL', 'runner', { error: String(err && err.message || err) });
  } finally {
    if (browser) browser.close();
    if (appServer) await new Promise(r => appServer.close(r));
    try { await pgClient.end(); } catch {}
    try { await epg.stop(); } catch {}
    try { fs.rmSync(pgDir, { recursive: true, force: true }); } catch {}
  }

  const summary = ledger.summary();
  const results = {
    contract: 'wf-phase10-disposable-canary-e2e-v1',
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    supersedes: 'tools/mariadb-live/run-disposable-browser-suite.py (left untouched; hard-coded/fabricated verification blocks)',
    environment: {
      postgres: 'embedded-postgres 18.4 (disposable, loopback only)',
      browser: resolveBrowserBin(),
      frontend: 'vite production build (dist/) served on loopback',
      api: 'real api/canary handlers over loopback PostgREST-RPC shim',
      external_network: 'none (npm install performed separately)',
      production_identifier_present: false,
    },
    VERCEL_PREVIEW: 'BLOCKED_NO_CREDENTIALS',
    screenshots,
    summary,
    assertions: ledger.assertions,
    pass: summary.FAIL === 0,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`[phase10] results written to ${resultsPath}`);
  console.log(`[phase10] summary: ${JSON.stringify(summary)}`);

  if (summary.FAIL > 0) exitCode = 1;
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[phase10] UNCAUGHT:', err && err.stack || err);
    process.exit(2);
  });
}

module.exports = {
  main,
  buildFixtures,
  seedFixtures,
  loadProcCatalog,
  makeRpcHandler,
  makeAppServer,
  CdpBrowserSession,
  resolveBrowserBin,
  CANARY_MIGRATIONS,
  AssertionLedger,
};
