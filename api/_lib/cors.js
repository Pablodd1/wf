'use strict';

/**
 * Shared CORS helper for public API endpoints.
 * ponytail: this module was required by model-stats.js and dealer-stats.js
 * (since a9598e4) but never committed — every invocation of those endpoints
 * died at require time with MODULE_NOT_FOUND → Vercel FUNCTION_INVOCATION_FAILED.
 *
 * Returns true when the request was an OPTIONS preflight (already answered)
 * so the caller can early-return.
 */
function setCorsHeaders(res, req) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req && req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = { setCorsHeaders };
