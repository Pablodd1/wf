const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyDisposition,
  imageFilename,
  sourceIdentity,
} = require('../tools/data-quality/audit-missing-raw-gap.cjs');

test('missing-raw audit recognizes only exact legacy source UUIDs', () => {
  assert.equal(
    sourceIdentity('mysql_auction_watches_0dc84b28-6a44-47d1-9fac-a146a50c3332'),
    '0dc84b28-6a44-47d1-9fac-a146a50c3332',
  );
  assert.equal(
    sourceIdentity('0dc84b28-6a44-47d1-9fac-a146a50c3332'),
    '0dc84b28-6a44-47d1-9fac-a146a50c3332',
  );
  assert.equal(sourceIdentity('media_other_677bfacf341c3'), '');
});

test('missing-raw audit normalizes image filenames without treating them as exact evidence', () => {
  assert.equal(
    imageFilename('https://example.test/listings/full/ABC_front_image.jpg?cache=1'),
    'abc_front_image.jpg',
  );
  const record = { id: 'media_other_1', flags: {} };
  const sourceMatches = new Map([['media_other_1', [{
    match_mode: 'FRONT_IMAGE_EXACT',
    source: { id: 'source-1' },
  }]]]);
  assert.deepEqual(
    classifyDisposition(record, new Map(), sourceMatches),
    {
      disposition: 'REVIEW_CANDIDATE',
      evidence_source: 'FRONT_IMAGE_ONLY',
      matches: sourceMatches.get('media_other_1'),
    },
  );
});

test('missing-raw audit prefers immutable raw evidence and exact source IDs', () => {
  const immutableRecord = { id: 'row-1', flags: { raw_message_id: 'raw-1' } };
  assert.equal(
    classifyDisposition(immutableRecord, new Map([['raw-1', { id: 'raw-1', raw_text: 'exact' }]]), new Map()).evidence_source,
    'IMMUTABLE_RAW_MESSAGES',
  );

  const sourceRecord = { id: 'row-2', flags: {} };
  const sourceMatches = new Map([['row-2', [{
    match_mode: 'SOURCE_ID_EXACT',
    source: { id: 'source-2', title: 'exact' },
  }]]]);
  assert.equal(
    classifyDisposition(sourceRecord, new Map(), sourceMatches).evidence_source,
    'SOURCE_EXPORT_ID_EXACT',
  );
});
