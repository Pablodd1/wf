'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeTradingCursor, encodeTradingCursor, tradingCursorFilter } = require('../api/_lib/trading-cursor.cjs');

test('round trips an opaque trading-floor cursor', () => {
  const encoded = encodeTradingCursor({ id: 'mysql_auctions_123-abc', created_at: '2026-07-20T18:30:00Z' });
  assert.deepEqual(decodeTradingCursor(encoded), {
    id: 'mysql_auctions_123-abc',
    createdAt: '2026-07-20T18:30:00.000Z',
  });
});

test('rejects malformed cursors and unsafe identifiers', () => {
  assert.equal(decodeTradingCursor('not-json'), null);
  const unsafe = Buffer.from(JSON.stringify({ createdAt: null, id: 'x),drop table' })).toString('base64url');
  assert.equal(decodeTradingCursor(unsafe), null);
});

test('keeps null-date history reachable before moving into dated records', () => {
  assert.equal(
    tradingCursorFilter({ createdAt: null, id: 'row_2' }),
    'or(and(created_at.is.null,id.lt.row_2),created_at.not.is.null)',
  );
});

test('round trips a bounded offset for image-first marketplace ordering', () => {
  const encoded = encodeTradingCursor({
    id: 'reviewed_zenith_000100_source',
    created_at: '2026-07-20T18:30:00Z',
    offset: 100,
  });
  assert.deepEqual(decodeTradingCursor(encoded), {
    id: 'reviewed_zenith_000100_source',
    createdAt: '2026-07-20T18:30:00.000Z',
    offset: 100,
  });
});
