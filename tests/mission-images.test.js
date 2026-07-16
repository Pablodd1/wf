import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicUrl, classifyMediaKind, classifyNamespace, extractObjectId, toInventoryRow } from '../tools/mission-images/lib.js';

test('extracts auction chat UUIDs', () => {
  assert.deepEqual(
    extractObjectId('auctions/chats/full/04e7e102-4b7b-4ce7-9123-20ba0ea24183_attachment1.png'),
    { id: '04e7e102-4b7b-4ce7-9123-20ba0ea24183', type: 'uuid' },
  );
});

test('extracts listing and certification hexadecimal IDs', () => {
  assert.equal(extractObjectId('jewelryListings/full/677bfacf341c3_front_image.png')?.id, '677bfacf341c3');
  assert.equal(extractObjectId('certifications/watchfacts/Report_Inspection_121212_65d4cb0a6e61d.pdf')?.id, '65d4cb0a6e61d');
});

test('extracts legacy numeric listing IDs instead of rendition directory names', () => {
  assert.deepEqual(
    extractObjectId('listings/250/1007_front_image.jpg'),
    { id: '1007', type: 'integer' },
  );
});

test('classifies namespaces and media without conflating record families', () => {
  assert.equal(classifyNamespace('auctions/chats/full/a.png'), 'auction_chat');
  assert.equal(classifyNamespace('listings/full/a.jpg'), 'listings');
  assert.equal(classifyNamespace('jewelryListings/full/a.jpg'), 'jewelry_listings');
  assert.equal(classifyMediaKind('certifications/report.pdf'), 'document');
});

test('constructs a safe public URL and normalized inventory row', () => {
  assert.equal(
    buildPublicUrl('https://example.test/', 'listings/full/my image.jpg'),
    'https://example.test/listings/full/my%20image.jpg',
  );
  const row = toInventoryRow({
    Bucket: 'thecollective-prod',
    Key: 'listings/full/68f3ab46252ac_front_image.jpg',
    Size: '173925',
    LastModified: '2025-10-18T14:59:18.211Z',
    ETag: 'abc',
  }, 'https://thecollective-prod.nyc3.digitaloceanspaces.com');
  assert.equal(row.extracted_id, '68f3ab46252ac');
  assert.equal(row.namespace, 'listings');
  assert.equal(row.mapping_status, 'PENDING');
});
