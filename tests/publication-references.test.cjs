'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FULL_REVIEWED_BRAND_RELEASE,
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_RECORD_PREFIX,
  REVIEWED_PANERAI_REFERENCES,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_PREFIX,
  REVIEWED_ZENITH_SOURCE,
  THREE_WATCH_RELEASE_REFERENCES,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
  isReviewedZenithIdentityCorrectionRecord,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
} = require('../api/_lib/publication-references.cjs');

const configured = [
  'Rolex::116610LN',
  'Patek Philippe::5712/1A',
  'Patek Philippe::5712/1A-001',
  'Rolex::126710BLNR',
].join('|');

test('three-watch release configuration is brand-scoped and exact', () => {
  assert.equal(publicationReferences(configured).length, 4);
  assert.deepEqual(publicationReferencesForBrand('Rolex', configured), ['116610LN', '126710BLNR']);
  assert.equal(isPublicationReferenceAllowed('rolex', '116610ln', configured), true);
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '5712/1A-001', configured), true);
  assert.equal(isPublicationReferenceAllowed('Rolex', '5712/1A-001', configured), false);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126610LN', configured), false);
});

test('reference normalization preserves identity while ignoring punctuation and case', () => {
  assert.equal(normalizePublicationReference(' 5712/1a-001 '), '57121A001');
  assert.equal(normalizePublicationReference('116610ln'), '116610LN');
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '57121A001', configured), false);
});

test('PostgREST release filter is a bounded exact IN predicate', () => {
  assert.equal(
    publicationReferencePostgrestFilter(configured),
    'in.("116610LN","5712/1A","5712/1A-001","126710BLNR")',
  );
});

test('an unset reference release configuration fails closed to the reviewed release', () => {
  assert.match(THREE_WATCH_RELEASE_REFERENCES, /Audemars Piguet::16202ST/);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126710BLNR', ''), true);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126610LN', ''), false);
  assert.equal(
    publicationReferencePostgrestFilter(''),
    'in.("116610LN","5712/1A","5712/1A-001","126710BLNR","16202ST","15500ST","15500","15400")',
  );
});

test('deployment configuration can restrict but never expand the reviewed release', () => {
  assert.deepEqual(publicationReferences('Rolex::116610LN'), [{
    brand: 'Rolex',
    reference: '116610LN',
    normalizedReference: '116610LN',
  }]);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126710BLNR', 'Rolex::116610LN'), false);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126610LN', 'Rolex::126610LN'), false);
  assert.equal(isPublicationReferenceAllowed('Rolex', '116610LN', '|'), false);
  assert.equal(isPublicationReferenceAllowed('Rolex', '116610LN', '116610LN'), false);
});

test('release eligibility requires approved finite confidence at or above 90', () => {
  assert.equal(MIN_RELEASE_CONFIDENCE, 90);
  const base = { brand: 'Rolex', reference: '116610LN', verdict: 'APPROVED', confidence: 90 };
  assert.equal(isReleaseListingEligible(base, configured), true);
  assert.equal(isReleaseListingEligible({ ...base, confidence: 89 }, configured), false);
  assert.equal(isReleaseListingEligible({ ...base, confidence: null }, configured), false);
  assert.equal(isReleaseListingEligible({ ...base, confidence: Number.NaN }, configured), false);
  assert.equal(isReleaseListingEligible({ ...base, verdict: 'HUMAN' }, configured), false);
  assert.equal(isReleaseListingEligible({ ...base, brand: 'Patek Philippe' }, configured), false);
});

test('full reviewed scope expands only the approved full-release brands', () => {
  assert.equal(FULL_REVIEWED_BRAND_RELEASE, 'ALL_REVIEWED');
  assert.deepEqual(publicationReferences(FULL_REVIEWED_BRAND_RELEASE), []);
  assert.equal(publicationReferencePostgrestFilter(FULL_REVIEWED_BRAND_RELEASE), null);
  assert.equal(isPublicationReferenceAllowed('Rolex', '126500LN', FULL_REVIEWED_BRAND_RELEASE), true);
  assert.equal(isPublicationReferenceAllowed('Patek Philippe', '5167A-001', FULL_REVIEWED_BRAND_RELEASE), true);
  assert.equal(isPublicationReferenceAllowed('Audemars Piguet', '15500ST', FULL_REVIEWED_BRAND_RELEASE), true);
  assert.equal(isPublicationReferenceAllowed('Rolex', '', FULL_REVIEWED_BRAND_RELEASE), false);
  assert.equal(isReleaseListingEligible({
    brand: 'Rolex',
    reference: '126500LN',
    verdict: 'APPROVED',
    confidence: 90,
  }, FULL_REVIEWED_BRAND_RELEASE), true);
});

test('reviewed Panerai release is limited to the exact workbook records', () => {
  assert.equal(REVIEWED_PANERAI_RECORD_IDS.length, 99);
  assert.equal(new Set(REVIEWED_PANERAI_RECORD_IDS).size, 99);
  assert.equal(REVIEWED_PANERAI_REFERENCES.length, 71);
  assert.equal(isPublicationReferenceAllowed('Panerai', 'PAM00590', ''), true);
  assert.equal(isPublicationReferenceAllowed('Panerai', 'PAM99999', FULL_REVIEWED_BRAND_RELEASE), false);
  const approved = {
    id: `${REVIEWED_PANERAI_RECORD_PREFIX}123`,
    brand: 'Panerai',
    reference: 'PAM00590',
    source: REVIEWED_PANERAI_SOURCE,
    verdict: 'APPROVED',
    confidence: 100,
  };
  assert.equal(isReleaseListingEligible(approved, ''), true);
  assert.equal(isReleaseListingEligible({ ...approved, id: 'legacy_123' }, ''), false);
  assert.equal(isReleaseListingEligible({ ...approved, source: 'legacy' }, ''), false);
  assert.equal(isReleaseListingEligible({ ...approved, reference: 'PAM99999' }, ''), false);
});

test('reviewed Zenith release is limited to the hash-locked workbook source and record prefix', () => {
  const approved = {
    id: `${REVIEWED_ZENITH_RECORD_PREFIX}000392_wf-example`,
    brand: 'Zenith',
    reference: '0331003600',
    source: REVIEWED_ZENITH_SOURCE,
    listing_status: 'ACTIVE',
    verdict: 'APPROVED',
    confidence: 100,
  };
  assert.equal(isPublicationReferenceAllowed('Zenith', '03.3100.3600', ''), true);
  assert.equal(isReleaseListingEligible(approved, ''), true);
  assert.equal(isReleaseListingEligible({ ...approved, id: 'legacy_zenith' }, ''), false);
  assert.equal(isReleaseListingEligible({ ...approved, source: 'legacy' }, ''), false);
  assert.equal(isReleaseListingEligible({ ...approved, listing_status: 'REJECTED' }, ''), false);
  assert.equal(isReleaseListingEligible({ ...approved, verdict: 'HUMAN' }, ''), false);
});

test('reviewed Zenith cross-brand corrections are limited to exact source rows', () => {
  const approved = {
    id: `${REVIEWED_ZENITH_RECORD_PREFIX}001020_wf-example`,
    brand: 'Rolex',
    model: 'Daytona',
    reference: '16520',
    dial_color: 'Black',
    source: REVIEWED_ZENITH_SOURCE,
    listing_status: 'ACTIVE',
    verdict: 'APPROVED',
    confidence: 100,
  };
  assert.equal(isReviewedZenithIdentityCorrectionRecord(approved), true);
  assert.equal(isReleaseListingEligible(approved, ''), true);
  assert.equal(isReviewedZenithIdentityCorrectionRecord({ ...approved, id: `${REVIEWED_ZENITH_RECORD_PREFIX}001019_wf-example` }), false);
  assert.equal(isReviewedZenithIdentityCorrectionRecord({ ...approved, brand: 'Zenith' }), false);
  assert.equal(isReviewedZenithIdentityCorrectionRecord({ ...approved, dial_color: null }), false);
  assert.equal(isReviewedZenithIdentityCorrectionRecord({ ...approved, source: 'legacy' }), false);
});
