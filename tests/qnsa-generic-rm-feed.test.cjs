'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/reviewed-market-inventory.js');

const source = fs.readFileSync(
  path.join(__dirname, '../api/reviewed-market-inventory.js'),
  'utf8',
);
test('generic watch discovery uses a bounded candidate cursor, not the slow joined view', () => {
  assert.match(source, /const genericWatchFeed = watchFeed && !brand/);
  assert.match(source, /const SIX_REVIEWED_WATCH_BRANDS = new Set\(\[[\s\S]*'Rolex'[\s\S]*'Patek Philippe'[\s\S]*'Audemars Piguet'[\s\S]*'Richard Mille'[\s\S]*'Cartier'[\s\S]*'Zenith'/);
  assert.match(source, /const sixBrandKeysetFeed = watchFeed && \(!brand \|\| SIX_REVIEWED_WATCH_BRANDS\.has\(brand\)\)/);
  assert.match(source, /sixBrandKeysetFeed[\s\S]*'qnsa_six_brand_image_lane_page'/);
  assert.match(source, /p_after_has_price: inventoryCursor\?\.keyset\?\.hasPrice \?\? null/);
  assert.match(source, /p_after_created_at: inventoryCursor\?\.keyset\?\.createdAt \?\? null/);
  assert.match(source, /p_after_id: inventoryCursor\?\.keyset\?\.id \?\? null/);
  assert.doesNotMatch(source, /qnsa_watch_market_candidate_page/);
  assert.match(source, /qnsaCandidateCursorMeta[\s\S]*candidateEnvelope\.nextOffset/);
  assert.match(source, /nextOffset = qnsaCandidateCursorMeta[\s\S]*qnsaCandidateCursorMeta\.nextOffset/);
});

test('inventory cursor round-trips the six-brand keyset without changing legacy cursors', () => {
  const token = api.encodeInventoryCursor({
    lane: 'images', offset: 0, page: 2,
    keyset: {
      hasPrice: false,
      createdAt: '2026-08-15T10:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426614174000',
    },
  });
  assert.deepEqual(api.parseInventoryCursor(token, 50), {
    lane: 'images', offset: 0, page: 2,
    keyset: {
      hasPrice: false,
      createdAt: '2026-08-15T10:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426614174000',
    },
  });
});

test('candidate envelopes reject malformed offsets and preserve exact cursor metadata', () => {
  assert.deepEqual(api.parseCandidatePageEnvelope({
    rows: [{ id: 'a' }], next_offset: 250, has_more: true, scanned_count: 250,
  }), {
    rows: [{ id: 'a' }], nextOffset: 250, nextKeyset: null, hasMore: true, scannedCount: 250,
  });
  assert.deepEqual(api.parseCandidatePageEnvelope([{
    qnsa_later_brand_candidate_stride_page: {
      rows: [{ id: 'rm-a' }], next_offset: 41, has_more: true, scanned_count: 50,
    },
  }], ['qnsa_later_brand_candidate_stride_page']), {
    rows: [{ id: 'rm-a' }], nextOffset: 41, nextKeyset: null, hasMore: true, scannedCount: 50,
  });
  assert.deepEqual(api.parseCandidatePageEnvelope({
    rows: [{ id: 'six-a' }],
    next_cursor: {
      has_price: true,
      created_at: '2026-08-15T10:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426614174000',
    },
    has_more: true,
    scanned_count: 100,
  }), {
    rows: [{ id: 'six-a' }],
    nextOffset: null,
    nextKeyset: {
      hasPrice: true,
      createdAt: '2026-08-15T10:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426614174000',
    },
    hasMore: true,
    scannedCount: 100,
  });
  assert.equal(api.parseCandidatePageEnvelope({
    rows: [], next_offset: -1, has_more: true, scanned_count: 1,
  }), null);
  assert.equal(api.parseCandidatePageEnvelope({
    rows: [], next_offset: 1, has_more: 'yes', scanned_count: 1,
  }), null);
});

test('the known mixed Richard Mille request remains withheld by the shared detector', () => {
  const risk = require('../api/_lib/unsplit-bundle-filter.cjs').multiItemRisk(
    'Looking RM001 WG RM002 WG',
  );
  assert.equal(risk.is_multi, true);
  assert.ok(risk.references.some(reference => /^RM\s*001$/i.test(reference)));
  assert.ok(risk.references.some(reference => /^RM\s*002$/i.test(reference)));
  assert.ok(risk.reasons.includes('MULTI_REFERENCE_REQUEST'));
});
