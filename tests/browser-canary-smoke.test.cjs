"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { exec } = require("node:child_process");

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
  const outFile = path.join(os.tmpdir(), `dom_out_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
  const cmd = `cmd.exe /c ""${BROWSER_BIN}" --headless=new --disable-gpu --no-sandbox --no-first-run --dump-dom "${url}" > "${outFile}""`;
  
  await new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const domOutput = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf-8") : "";
  try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch(e) {}
  return domOutput;
}

test("Actual Headless Chrome / Edge Browser Smoke Tests", async (t) => {
  assert.ok(fs.existsSync(BROWSER_BIN), `Browser executable must exist at ${BROWSER_BIN}`);

  await t.test("1. Browser renders Trading Floor UI cleanly", async () => {
    const targetUrl = `${baseUrl}/trading-floor`;
    const domOutput = await runHeadlessBrowser(targetUrl);

    assert.ok(domOutput.includes('id="root"'), "DOM must contain root React mounting element");
    assert.ok(domOutput.includes("<html") && domOutput.includes("</html>"), "DOM must contain valid HTML tags");
    assert.ok(domOutput.length > 500, "DOM output must contain rendered content");
  });

  await t.test("2. Browser renders Price Research UI cleanly", async () => {
    const targetUrl = `${baseUrl}/price-research`;
    const domOutput = await runHeadlessBrowser(targetUrl);

    assert.ok(domOutput.includes('id="root"'), "DOM must contain root React mounting element");
    assert.ok(domOutput.includes("<html") && domOutput.includes("</html>"), "DOM must contain valid HTML tags");
    assert.ok(domOutput.length > 500, "DOM output must contain rendered content");
  });
});
