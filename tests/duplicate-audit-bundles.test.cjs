'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditCandidates, likelyBundle } = require('../tools/duplicate-audit/bundle-candidates.cjs');

test('splits bundle rows into candidate-level records before duplicate analysis', () => {
  const row = {
    id: 'source-1',
    brand: 'Rolex',
    reference: '126500LN',
    dial_color: 'Unknown',
    condition: 'NEW',
    listing_type: 'WTS',
    raw_message: 'Rolex\n126500LN White HKD 283000\n126610LN Black HKD 114000\n126710BLNR Blue HKD 149000',
  };

  const candidates = auditCandidates(row);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(candidate => candidate.bundle_parent_id), ['source-1', 'source-1', 'source-1']);
  assert.deepEqual(candidates.map(candidate => candidate.bundle_candidate_index), [1, 2, 3]);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['126500LN', '126610LN', '126710BLNR']);
});

test('does not present unresolved bundle envelopes as one duplicate candidate', () => {
  const row = {
    id: 'source-2',
    brand: 'Rolex',
    raw_message: 'Inventory\nline one\nline two\nline three\nline four\nline five\nline six\nline seven',
  };
  assert.deepEqual(auditCandidates(row), []);
});

test('routes a synthetic concise two-watch regression through canonical segmentation', () => {
  const row = {
    id: 'source-3',
    brand: 'Rolex',
    condition: 'NEW',
    listing_type: 'WTS',
    raw_message: 'Rolex 126500LN White HKD 95K\nRolex 126610LN Black USD 12K',
  };

  assert.equal(likelyBundle(row), true);
  const candidates = auditCandidates(row);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['126500LN', '126610LN']);
  assert.deepEqual(candidates.map(candidate => candidate.bundle_parent_id), ['source-3', 'source-3']);
});

test('uses persisted shadow bundle evidence even when raw segmentation is unresolved', () => {
  const row = {
    id: 'source-4',
    listing_type: 'WTS',
    flags: ['BUNDLE_SPLIT_REQUIRED'],
    raw_message: 'Inventory pending structured child review',
  };

  assert.equal(likelyBundle(row), true);
  assert.deepEqual(auditCandidates(row), []);
});
