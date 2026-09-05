'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChildLineageRow,
  childIntent,
  clusterReviewCsv,
  exactLineageReady,
  sellerConfigurationKey,
  sellerRepostKey,
  summarizeRepostClusters,
} = require('../tools/dealer-lineage/reconcile-child-lineage.cjs');
const { stagingRow } = require('../tools/dealer-lineage/stage-child-lineage-manifest.cjs');
const fs = require('node:fs');
const path = require('node:path');

const child = {
  id: 'child-1',
  brand: 'Patek Philippe',
  reference: '5712/1A',
  dial_color: 'Blue',
  condition: 'Used',
  price_usd: 100000,
  currency: 'USD',
  listing_type: 'WTS',
  created_at: '2025-01-08T13:28:49+00:00',
  field_confidence: { source_record_id: 'parent-1', source_child_id: 'parent-1_001' },
};

const lineage = {
  source_system: 'UNBUNDLED_RAW_MESSAGE',
  source_record_id: 'parent-1',
  seller_listing_id: 'seller-row-1',
  seller_phone_normalized: '85260161840',
  observed_names: ['Verified only later'],
  source_intent: 'WTS',
  source_posted_at: '2025-01-08T18:28:49.000Z',
  source_posted_at_raw: 'Wed Jan 08 2025 13:28:49 GMT-0500',
  front_image: 'parent_front.jpg',
  match_status: 'A_AUTO_STAGE',
  match_evidence: {
    exact_raw_message_sha1: true,
    exact_wall_clock_second: true,
    unique_phone_identity: true,
    intent_agreement: true,
  },
};

test('recognizes only customer listing intents', () => {
  assert.equal(childIntent('WTS'), 'WTS');
  assert.equal(childIntent('NTQ'), 'WTB');
  assert.equal(childIntent('trade'), null);
});

test('requires every deterministic parent-lineage gate', () => {
  assert.equal(exactLineageReady(lineage), true);
  assert.equal(exactLineageReady({ ...lineage, match_status: 'B_REVIEW_REQUIRED' }), false);
  assert.equal(exactLineageReady({ ...lineage, match_evidence: { ...lineage.match_evidence, exact_raw_message_sha1: false } }), false);
  assert.equal(exactLineageReady({ ...lineage, source_posted_at: null }), false);
});

test('creates private observed identity without publishing dealer contact or images', () => {
  const result = buildChildLineageRow(child, lineage);
  assert.equal(result.source_posted_at, '2025-01-08T18:28:49.000Z');
  assert.equal(result.observed_seller.identity_value, '85260161840');
  assert.equal(result.observed_seller.verification_status, 'OBSERVED_SOURCE_IDENTITY');
  assert.equal(result.activity_count_eligible, true);
  assert.equal(result.dealer_id, null);
  assert.equal(result.public_contact_eligible, false);
  assert.equal(result.parent_front_image, 'parent_front.jpg');
  assert.equal(result.child_image_publication_eligible, false);
  assert.equal(result.publication_status, 'UNCHANGED');
  assert.equal(result.duplicate_suppression_status, 'NOT_EVALUATED_FOR_SUPPRESSION');
});

test('preserves identity but blocks activity counts when child and parent intent differ', () => {
  const result = buildChildLineageRow({ ...child, listing_type: 'WTB' }, lineage);
  assert.equal(result.observed_seller.identity_value, '85260161840');
  assert.equal(result.child_intent, 'WTB');
  assert.equal(result.source_parent_intent, 'WTS');
  assert.equal(result.activity_count_eligible, false);
  assert.ok(result.review_reasons.includes('CHILD_PARENT_INTENT_MISMATCH'));
});

test('rejects a child linked to a different parent', () => {
  assert.throws(() => buildChildLineageRow(child, { ...lineage, source_record_id: 'parent-2' }), /Parent lineage mismatch/);
});

test('seller-aware repost groups require the same observed seller and multiple parents', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  const key = sellerRepostKey(child, privateRow);
  const groups = new Map([[key, {
    sellerIdentityPseudonym: privateRow.observed_seller.identity_pseudonym,
    listingFingerprint: privateRow.listing_fingerprint,
    count: 2,
    parentIds: new Set(['parent-1', 'parent-2']),
    childIds: ['child-1', 'child-2'],
    sourceDates: new Set(['2025-01-08T18:28:49.000Z', '2025-02-08T18:28:49.000Z']),
  }]]);
  const result = summarizeRepostClusters(groups);
  assert.equal(result.length, 1);
  assert.equal(result[0].parent_count, 2);
  assert.equal(result[0].policy, 'HUMAN_REPOST_REVIEW_REQUIRED');
});

test('exports a pseudonymous reviewer CSV without raw seller contact', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  const csv = clusterReviewCsv([{
    seller_identity_pseudonym: privateRow.observed_seller.identity_pseudonym,
    listing_fingerprint: privateRow.listing_fingerprint,
    count: 2,
    parent_count: 2,
    parent_ids: ['parent-1', 'parent-2'],
    child_ids: ['child-1', 'child-2'],
    source_dates: ['2025-01-08T18:28:49.000Z', '2025-02-08T18:28:49.000Z'],
    policy: 'HUMAN_REPOST_REVIEW_REQUIRED',
  }]);
  assert.match(csv, /review_decision,review_notes/);
  assert.match(csv, new RegExp(privateRow.observed_seller.identity_pseudonym));
  assert.doesNotMatch(csv, /85260161840/);
});

test('configuration review groups ignore condition and price but retain seller and dial', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  const changedConditionAndPrice = { ...child, condition: 'New', price_usd: 110000 };
  assert.equal(sellerConfigurationKey(child, privateRow), sellerConfigurationKey(changedConditionAndPrice, privateRow));
  assert.notEqual(
    sellerConfigurationKey(child, privateRow),
    sellerConfigurationKey({ ...child, dial_color: 'Black' }, privateRow),
  );
});

test('stages child lineage without public contact, image, dealer, or publication authority', () => {
  const result = stagingRow(buildChildLineageRow(child, lineage));
  assert.equal(result.child_id, 'child-1');
  assert.equal(result.seller_identity_pseudonym.length, 20);
  assert.equal(result.dealer_id, null);
  assert.equal(result.public_contact_eligible, false);
  assert.equal(result.child_image_publication_eligible, false);
  assert.equal(result.review_status, 'PENDING');
});

test('rejects a child manifest that attempts public release', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  assert.throws(() => stagingRow({ ...privateRow, public_contact_eligible: true }), /Public release gate failed/);
});

test('child lineage migration is private and review-only', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260721120000_seller_child_lineage_staging.sql'),
    'utf8',
  );
  assert.match(sql, /REVOKE ALL ON public\.seller_child_lineage_staging FROM anon, authenticated/i);
  assert.match(sql, /CHECK \(public_contact_eligible IS false\)/i);
  assert.match(sql, /CHECK \(child_image_publication_eligible IS false\)/i);
  assert.match(sql, /REFERENCES public\.seller_listing_lineage_staging/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.watch_records/i);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|ALL)[^;]* TO authenticated/i);
});
