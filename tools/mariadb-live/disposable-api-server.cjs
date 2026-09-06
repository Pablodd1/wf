'use strict';

/**
 * Checked-in staging server for disposable browser smoke testing.
 * Serves static dist/ build and proxies /api/canary/* to genuine Vercel serverless handlers
 * connected only to the disposable PostgreSQL database.
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');
const identityHandler = require(path.join(repoRoot, 'api', 'canary', 'identity.js'));
const tradingFloorHandler = require(path.join(repoRoot, 'api', 'canary', 'trading-floor.js'));
const priceResearchHandler = require(path.join(repoRoot, 'api', 'canary', 'price-research.js'));

function adaptVercelHandler(handler) {
  return async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    req.query = parsedUrl.query || {};

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Handler error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    }
  };
}

const routes = {
  '/api/canary/identity': adaptVercelHandler(identityHandler),
  '/api/canary/trading-floor': adaptVercelHandler(tradingFloorHandler),
  '/api/reviewed-market-inventory': adaptVercelHandler(tradingFloorHandler),
  '/api/canary/price-research': adaptVercelHandler(priceResearchHandler),
  '/api/price-research': adaptVercelHandler(priceResearchHandler)
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  // 1. Canary API Routes
  if (routes[pathname]) {
    return routes[pathname](req, res);
  }

  // 2. Mock non-canary API routes if queried by frontend
  if (pathname.startsWith('/api/')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: 'ok', records: [], items: [] }));
  }

  // 3. Static Assets from dist/
  const distDir = path.join(repoRoot, 'dist');
  let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    return fs.createReadStream(filePath).pipe(res);
  }

  // Fallback for SPA navigation: return dist/index.html
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(indexPath).pipe(res);
  }

  res.statusCode = 404;
  res.end('Not Found');
});

const port = parseInt(process.env.PORT || '3001', 10);
server.listen(port, '127.0.0.1', () => {
  console.log(`Disposable staging server listening on http://127.0.0.1:${port}`);
});
