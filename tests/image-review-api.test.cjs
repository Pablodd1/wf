'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const queueHandler = require('../api/image-review-queue.js');
const decisionHandler = require('../api/image-review-decision.js');

const ROOT = path.resolve(__dirname, '..');
const queueSource = fs.readFileSync(path.join(ROOT, 'api', 'image-review-queue.js'), 'utf8');
const decisionSource = fs.readFileSync(path.join(ROOT, 'api', 'image-review-decision.js'), 'utf8');
const advisorySource = fs.readFileSync(path.join(ROOT, 'api', 'verify-image.js'), 'utf8');

test('image review queue is reviewer-only, bounded, keyset-paginated, and approval-safe', () => {
  assert.match(queueSource, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(queueSource, /boundedInteger\(req\.query\?\.limit, 50, 1, 50\)/);
  assert.match(queueSource, /\.gt\('source_object_key', after\)/);
  assert.match(queueSource, /\.limit\(limit \+ 1\)/);
  assert.match(queueSource, /\.eq\('image_status', 'SOURCE_LINKED'\)/);
  assert.match(queueSource, /\.in\('identity_status', VERIFIED_IDENTITY_STATUSES\)/);
  assert.match(queueSource, /'CATALOG_CONFIRMED', 'HUMAN_APPROVED'/);
  assert.match(queueSource, /isFullReviewedBrandRelease\(\)/);
  assert.match(queueSource, /\['Rolex', 'Patek Philippe', 'Audemars Piguet'\]\.filter/);
  assert.match(queueSource, /nextCursor/);
  assert.match(queueSource, /hasMore:/);
  assert.doesNotMatch(queueSource, /offset\(/i);
});

test('queue returns current identity, raw source evidence, and image evidence without hiding blockers', () => {
  const item = queueHandler.reviewItem({
    source_object_key: 'images/source-1.jpg',
    public_url: 'https://images.example/source-1.jpg',
    record_id: 'record-1',
    brand: 'Raw brand',
    model: 'Raw model',
    reference: 'RAW-1',
    dial_color: 'Raw dial',
    raw_message: 'Exact immutable listing message',
    image_status: 'SOURCE_LINKED',
    identity_status: 'CATALOG_CONFIRMED',
    evidence: { source_lineage: 'exact' },
  }, {
    status: 'CATALOG_CONFIRMED',
    canonical_brand: 'Rolex',
    canonical_model: 'Daytona',
    canonical_reference: '116500LN',
    canonical_dial_color: 'White',
  });
  assert.equal(item.brand, 'Rolex');
  assert.equal(item.raw_message, 'Exact immutable listing message');
  assert.deepEqual(item.evidence, { source_lineage: 'exact' });
  assert.equal(item.review_blocked, false);

  const blocked = queueHandler.reviewItem({
    source_object_key: 'images/source-2.jpg',
    record_id: 'record-2',
    image_status: 'SOURCE_LINKED',
    identity_status: 'CATALOG_CONFIRMED',
  }, { status: 'CATALOG_CONFIRMED' });
  assert.equal(blocked.review_blocked, true);
  assert.ok(blocked.review_blockers.includes('MISSING_PUBLIC_URL'));
  assert.ok(blocked.review_blockers.includes('MISSING_RAW_MESSAGE'));
  const missingIdentity = queueHandler.reviewItem({
    source_object_key: 'images/source-3.jpg',
    public_url: 'https://images.example/source-3.jpg',
    record_id: 'record-3',
    brand: 'Rolex',
    model: 'Daytona',
    reference: '116500LN',
    dial_color: 'White',
    raw_message: 'Exact immutable listing message',
    image_status: 'SOURCE_LINKED',
    identity_status: 'CATALOG_CONFIRMED',
  }, null);
  assert.ok(missingIdentity.review_blockers.includes('CURRENT_IDENTITY_NOT_FOUND'));
});

test('image decision accepts only explicit MATCH or NO_MATCH with a meaningful reason', () => {
  assert.deepEqual(decisionHandler.validateDecisionBody({
    sourceObjectKey: 'images/source-1.jpg',
    recordId: 'record-1',
    visualMatch: 'match',
    reason: 'Exact dial and reference match the listing.',
  }).value, {
    sourceObjectKey: 'images/source-1.jpg',
    recordId: 'record-1',
    visualMatch: 'MATCH',
    reason: 'Exact dial and reference match the listing.',
  });
  assert.match(decisionHandler.validateDecisionBody({
    sourceObjectKey: 'images/source-1.jpg',
    recordId: 'record-1',
    visualMatch: 'MAYBE',
    reason: 'This is long enough but unsupported.',
  }).error, /MATCH or NO_MATCH/);
  assert.match(decisionHandler.validateDecisionBody({
    sourceObjectKey: 'images/source-1.jpg',
    recordId: 'record-1',
    visualMatch: 'MATCH',
    reason: 'too short',
  }).error, /12 to 1000/);
});

test('image decisions use the current server-side identity snapshot and the audited RPC only', () => {
  assert.deepEqual(decisionHandler.exactIdentitySnapshot({
    brand: 'Raw brand',
    model: 'Raw model',
    reference: 'RAW-1',
    dial_color: 'Raw dial',
  }, {
    status: 'HUMAN_APPROVED',
    canonical_brand: 'Patek Philippe',
    canonical_model: 'Nautilus',
    canonical_reference: '5712/1A',
    canonical_dial_color: 'Blue',
  }), {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A',
    dial_color: 'Blue',
  });
  assert.throws(
    () => decisionHandler.exactIdentitySnapshot({}, { status: 'CONFLICT' }),
    /VERIFIED_IDENTITY_REQUIRED/,
  );
  assert.throws(
    () => decisionHandler.exactIdentitySnapshot({}, { status: 'CATALOG_CONFIRMED' }),
    /COMPLETE_IDENTITY_REQUIRED/,
  );

  assert.match(decisionSource, /if \(!sameOrigin\(req\)\)/);
  assert.match(decisionSource, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(decisionSource, /MATCH: 'VISUALLY_VERIFIED'/);
  assert.match(decisionSource, /NO_MATCH: 'REJECTED'/);
  assert.match(decisionSource, /auth\.user\.email \|\| auth\.user\.id/);
  assert.match(decisionSource, /\.rpc\('apply_listing_image_review'/);
  assert.match(decisionSource, /p_identity_snapshot: identitySnapshot/);
  assert.match(decisionSource, /p_evidence: evidence/);
  assert.doesNotMatch(decisionSource, /\.from\('watch_records'\)/);
  assert.doesNotMatch(decisionSource, /\.from\('media_manifest'\)/);
  assert.doesNotMatch(decisionSource, /\.(?:update|insert|delete)\(/);
});

test('visual assistance is reviewer-only, same-origin, quota-bounded, and cannot write a listing', () => {
  assert.match(advisorySource, /if \(!sameOrigin\(req\)\)/);
  assert.match(advisorySource, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(advisorySource, /consumeAiQuota\(req, \{ route: 'image-visual-advisory', limit: 20 \}\)/);
  assert.match(advisorySource, /classifyVisualAdvisory\(claim, vision\.parsed\)/);
  assert.match(advisorySource, /OPENAI_API_KEY/);
  assert.match(advisorySource, /visionOpenAI/);
  assert.match(advisorySource, /visionKimi\(kimiKey, imageUrl\)/);
  assert.match(advisorySource, /visionOpenAI\(openaiKey, imageUrl\)/);
  assert.match(advisorySource, /Image review assistance is not configured/);
  assert.match(advisorySource, /does not attach images, alter listing fields, approve a review, or publish a listing/);
  assert.doesNotMatch(advisorySource, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(advisorySource, /\.from\('watch_records'\)/);
  assert.doesNotMatch(advisorySource, /\.(?:update|insert|delete)\(/);
});
