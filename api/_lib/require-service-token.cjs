'use strict';

const { timingSafeEqual } = require('node:crypto');

function tokensMatch(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasServiceToken(req) {
  const expected = process.env.INGEST_API_TOKEN;
  if (!expected) return false;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return tokensMatch(supplied, expected);
}

function requireServiceToken(req, res) {
  const expected = process.env.INGEST_API_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'Service authentication is not configured' });
    return false;
  }

  if (!hasServiceToken(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = { hasServiceToken, requireServiceToken, tokensMatch };
