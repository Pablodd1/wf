'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { intentBucket, observedPoster, postingYear, pseudonym } = require('../tools/source-activity-audit/source-identity.cjs');

test('explicit seller phone outranks message-envelope evidence', () => {
  assert.deepEqual(observedPoster({ seller_phone: '+1 212 555 0199', raw_message: '[7/12] +852 6236 1307: Rolex' }), {
    value: '12125550199', evidence: 'SELLER_PHONE_COLUMN',
  });
});

test('message envelope phone is extracted without storing formatting', () => {
  assert.deepEqual(observedPoster({ raw_message: '[7/12, 7:19 AM] +852 6236 1307: Rolex 126500' }), {
    value: '85262361307', evidence: 'MESSAGE_ENVELOPE_PHONE',
  });
});

test('NTQ is reported as WTB and unknown values stay explicit', () => {
  assert.equal(intentBucket('NTQ'), 'WTB');
  assert.equal(intentBucket('WTB'), 'WTB');
  assert.equal(intentBucket(''), 'UNKNOWN');
});

test('posting year prefers listing date over import creation time', () => {
  assert.equal(postingYear({ listing_date: '2024-06-03T00:00:00Z', created_at: '2026-07-16T00:00:00Z' }), 2024);
});

test('posting year never substitutes the database import timestamp', () => {
  assert.equal(postingYear({ listing_date: null, created_at: '2026-07-16T00:00:00Z' }), null);
});

test('poster pseudonyms are stable, keyed, and do not expose the source', () => {
  const first = pseudonym('85262361307', 'audit-key');
  assert.equal(first, pseudonym('85262361307', 'audit-key'));
  assert.notEqual(first, pseudonym('85262361307', 'another-key'));
  assert.equal(first.includes('85262361307'), false);
});
