"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const tradingFloorHandler = require("../api/canary/trading-floor");
const priceResearchHandler = require("../api/canary/price-research");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BROWSER_BIN = fs.existsSync(EDGE_PATH) ? EDGE_PATH : CHROME_PATH;

const distDir = path.resolve(__dirname, "../dist");

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      req.query = Object.fromEntries(parsedUrl.searchParams);

      res.setHeader("Connection", "close");
      res.status = function(code) {
        this.statusCode = code;
        return this;
      };
      res.json = function(data) {
        this.setHeader("Content-Type", "application/json");
        this.end(JSON.stringify(data));
      };

      if (parsedUrl.pathname.startsWith("/api/canary/trading-floor")) {
        return tradingFloorHandler(req, res);
      }
      if (parsedUrl.pathname.startsWith("/api/canary/price-research")) {
        return priceResearchHandler(req, res);
      }

      // Serve static files from dist
      let filePath = path.join(distDir, parsedUrl.pathname === "/" ? "index.html" : parsedUrl.pathname);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, "index.html");
      }

      const ext = path.extname(filePath);
      const mimeTypes = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml"
      };

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
        res.end(content);
      } catch (err) {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    if (server) {
      server.close(resolve);
    } else {
      resolve();
    }
  });
});

async function runHeadlessBrowser(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-browser-smoke-'));
  try {
    return await new Promise((resolve, reject) => {
      execFile(BROWSER_BIN, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking',
        `--user-data-dir=${profile}`, '--virtual-time-budget=3000', '--dump-dom', url],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout);
      });
    });
  } finally {
    // Only this newly created disposable profile may be removed. Never use
    // the user's default browser profile or build a cross-shell delete command.
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())
      || !path.basename(profile).startsWith('wf-browser-smoke-')) throw new Error('Unexpected disposable browser profile');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* A browser child may still hold its own temporary files. */ }
  }
}

test("Actual Headless Chrome / Edge Browser Smoke Tests", async (t) => {
  assert.ok(fs.existsSync(BROWSER_BIN), `Browser executable must exist at ${BROWSER_BIN}`);

  await t.test("1. Browser renders Trading Floor UI cleanly", async () => {
    const targetUrl = `${baseUrl}/#/trading`;
    const domOutput = await runHeadlessBrowser(targetUrl);

    assert.ok(domOutput.includes('id="root"'), "DOM must contain root React mounting element");
    assert.ok(domOutput.includes("<html") && domOutput.includes("</html>"), "DOM must contain valid HTML tags");
    assert.ok(domOutput.length > 500, "DOM output must contain rendered content");
    assert.match(domOutput, /<h1\b[^>]*>Trading Floor<\/h1>/, "The actual Trading Floor heading must render, not only an empty mounting element");
  });

  await t.test("2. Browser renders Price Research UI cleanly", async () => {
    const targetUrl = `${baseUrl}/#/price-research`;
    const domOutput = await runHeadlessBrowser(targetUrl);

    assert.ok(domOutput.includes('id="root"'), "DOM must contain root React mounting element");
    assert.ok(domOutput.includes("<html") && domOutput.includes("</html>"), "DOM must contain valid HTML tags");
    assert.ok(domOutput.length > 500, "DOM output must contain rendered content");
    assert.match(domOutput, /<h1\b[^>]*>Price Research<\/h1>/, "The actual Price Research route must render");
  });
});
