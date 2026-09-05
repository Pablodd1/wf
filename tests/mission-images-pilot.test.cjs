'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSourceId, candidateRecordIds } = require('../tools/mission-images/pilot-link-images.cjs');

test('extracts a UUID from an auction attachment key', () => {
  assert.equal(extractSourceId('auctions/chats/full/04e7e102-4b7b-4ce7-9123-20ba0ea24183_attachment1.png'), '04e7e102-4b7b-4ce7-9123-20ba0ea24183');
});

test('extracts an object id from listing and certification names', () => {
  assert.equal(extractSourceId('jewelryListings/full/677bfacf341c3_front_image.png'), '677bfacf341c3');
  assert.equal(extractSourceId('certifications/watchfacts/Report_Inspection_121212_65d4cb0a6e61d.pdf'), '65d4cb0a6e61d');
});

test('builds known historical record id variants', () => {
  assert.deepEqual(candidateRecordIds('abc'), ['abc', 'mysql_auctions_abc', 'mysql_auction_watches_abc']);
});
