'use strict';

const THREE_WATCH_RELEASE_REFERENCES = [
  'Rolex::116610LN',
  'Rolex::116500LN',
  'Rolex::126500LN',
  'Rolex::52506',
  'Patek Philippe::5712/1A',
  'Patek Philippe::5712/1A-001',
  'Patek Philippe::5712',
  'Patek Philippe::5712G',
  'Patek Philippe::5712G-001',
  'Patek Philippe::5712R',
  'Patek Philippe::5712R-001',
  'Patek Philippe::5712/1R',
  'Patek Philippe::5712/1R-001',
  'Patek Philippe::3712/1A',
  'Rolex::126710BLNR',
  'Audemars Piguet::16202ST',
  'Audemars Piguet::15500ST',
  'Audemars Piguet::15500',
  'Audemars Piguet::15400'
].join('|');
const FULL_REVIEWED_BRAND_RELEASE = 'ALL_REVIEWED';
const FULL_REVIEWED_BRANDS = new Set(['rolex', 'patek philippe', 'audemars piguet', 'richard mille', 'cartier', 'zenith']);
const MIN_RELEASE_CONFIDENCE = 90;
const REVIEWED_PANERAI_RECORD_PREFIX = 'reviewed_panerai_';
const REVIEWED_PANERAI_SOURCE = 'PANERAI_REVIEWED_XLSX_20260729';
const REVIEWED_ZENITH_RECORD_PREFIX = 'reviewed_zenith_';
const REVIEWED_ZENITH_RECORD_START = 'reviewed_zenith_000000';
const REVIEWED_ZENITH_RECORD_END = 'reviewed_zenith_999999';
const REVIEWED_ZENITH_SOURCE = 'ZENITH_REVIEWED_XLSX_20260730';
const REVIEWED_ZENITH_IDENTITY_CORRECTION_ROWS = new Set([
  168, 169, 170, 171, 172, 173, 174,
  287, 288, 289, 290, 291, 292, 293,
  1020, 1107, 1116, 1117, 1139, 1159,
]);
function reviewedPaneraiRecordRange(auctionId, start, end) {
  return Array.from(
    { length: end - start + 1 },
    (_, offset) => `${REVIEWED_PANERAI_RECORD_PREFIX}${auctionId}_${String(start + offset).padStart(3, '0')}`,
  );
}
const REVIEWED_PANERAI_RECORD_IDS = [
  ...reviewedPaneraiRecordRange('0010e7f0-3af7-420e-a759-487c4ce9cea2', 0, 9),
  ...reviewedPaneraiRecordRange('00408f57-3edf-42bd-8b7e-75726428cde6', 0, 4),
  ...reviewedPaneraiRecordRange('00421d4d-1a5b-46f5-9625-0f4a226052f7', 0, 1),
  ...reviewedPaneraiRecordRange('005dd8fa-4f22-4a2e-b06a-83c60cf1f668', 0, 11),
  ...reviewedPaneraiRecordRange('0061d229-bcec-416a-8f0f-34ca5e1c222a', 5, 5),
  ...reviewedPaneraiRecordRange('00694649-2c55-44b7-9678-105d23571e1b', 0, 10),
  ...reviewedPaneraiRecordRange('006cad5b-bac9-4460-b7ce-bda530f0ac9f', 11, 12),
  ...reviewedPaneraiRecordRange('00768367-3ece-478c-888f-f8c05f2a6ca5', 0, 12),
  ...reviewedPaneraiRecordRange('008b63d5-67c9-40a7-8847-604329c1eeb7', 0, 12),
  ...reviewedPaneraiRecordRange('009cff25-4842-4e7b-b27e-559cf25e2f50', 9, 9),
  ...reviewedPaneraiRecordRange('00c8c445-d896-436c-affb-e8042082abef', 1, 2),
  ...reviewedPaneraiRecordRange('00cf534f-9805-4f73-865f-8111226100db', 7, 7),
  ...reviewedPaneraiRecordRange('01133876-1908-40cf-8498-cd784d868308', 0, 8),
  ...reviewedPaneraiRecordRange('012f70af-d1bf-48e9-835e-6c3e037cf0e5', 0, 13),
  ...reviewedPaneraiRecordRange('01afa01f-fe3e-42a8-b527-316b4a7adced', 14, 14),
  ...reviewedPaneraiRecordRange('01e401c5-ab5b-4970-a848-3f2cd2e884d0', 5, 6),
];
const REVIEWED_PANERAI_REFERENCES = [
  'PAM00005', 'PAM00028', 'PAM00048', 'PAM00088', 'PAM00093', 'PAM00104',
  'PAM00111', 'PAM00112', 'PAM00233', 'PAM00241', 'PAM00292', 'PAM00305',
  'PAM00307', 'PAM00346', 'PAM00375', 'PAM00380', 'PAM00395', 'PAM00514',
  'PAM00569', 'PAM00571', 'PAM00590', 'PAM00609', 'PAM00628', 'PAM00660',
  'PAM00671', 'PAM00676', 'PAM00685', 'PAM00692', 'PAM00741', 'PAM00760',
  'PAM00774', 'PAM00777', 'PAM00779', 'PAM00904', 'PAM00926', 'PAM00927',
  'PAM00973', 'PAM01000', 'PAM01005', 'PAM01041', 'PAM01043', 'PAM01046',
  'PAM01084', 'PAM01085', 'PAM01110', 'PAM01124', 'PAM01229', 'PAM01249',
  'PAM01250', 'PAM01287', 'PAM01289', 'PAM01291', 'PAM01293', 'PAM01305',
  'PAM01312', 'PAM01314', 'PAM01321', 'PAM01334', 'PAM01335', 'PAM01359',
  'PAM01372', 'PAM01392', 'PAM01393', 'PAM01409', 'PAM01441', 'PAM01499',
  'PAM01518', 'PAM01661', 'PAM01669', 'PAM01697', 'PAM02068',
];
const REVIEWED_PANERAI_REFERENCE_SET = new Set(REVIEWED_PANERAI_REFERENCES);

function normalizePublicationReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parsedReferences(value) {
  return [...new Map(String(value || '')
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const separator = entry.indexOf('::');
      if (separator < 1) return null;
      const brand = entry.slice(0, separator).trim();
      const reference = entry.slice(separator + 2).trim();
      const normalizedReference = normalizePublicationReference(reference);
      return [`${brand.toLowerCase()}::${normalizedReference}`, {
        brand,
        reference,
        normalizedReference,
      }];
    })
    .filter(entry => entry && entry[1].brand && entry[1].normalizedReference)).values()];
}

const REVIEWED_RELEASE_REFERENCES = parsedReferences(THREE_WATCH_RELEASE_REFERENCES);

function isReviewedReleaseReference(brand, reference) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const exactReference = String(reference || '').trim().toUpperCase();
  if (!normalizedBrand || !exactReference) return false;
  return REVIEWED_RELEASE_REFERENCES.some(entry => (
    entry.brand.toLowerCase() === normalizedBrand
    && entry.reference.toUpperCase() === exactReference
  ));
}

function isReviewedPaneraiReference(brand, reference) {
  return String(brand || '').trim().toLowerCase() === 'panerai'
    && REVIEWED_PANERAI_REFERENCE_SET.has(String(reference || '').trim().toUpperCase());
}

function isReviewedPaneraiReleaseRecord(record) {
  const confidence = Number(record?.confidence);
  return Boolean(
    record
    && isReviewedPaneraiReference(record.brand, record.reference)
    && String(record.id || '').startsWith(REVIEWED_PANERAI_RECORD_PREFIX)
    && String(record.source || '') === REVIEWED_PANERAI_SOURCE
    && String(record.verdict || '').trim().toUpperCase() === 'APPROVED'
    && Number.isFinite(confidence)
    && confidence >= MIN_RELEASE_CONFIDENCE
  );
}

function isReviewedZenithReleaseRecord(record) {
  const confidence = Number(record?.confidence);
  return Boolean(
    record
    && String(record.brand || '').trim().toLowerCase() === 'zenith'
    && String(record.id || '').startsWith(REVIEWED_ZENITH_RECORD_PREFIX)
    && String(record.source || '') === REVIEWED_ZENITH_SOURCE
    && String(record.verdict || '').trim().toUpperCase() === 'APPROVED'
    && String(record.listing_status || 'ACTIVE').trim().toUpperCase() === 'ACTIVE'
    && Number.isFinite(confidence)
    && confidence >= MIN_RELEASE_CONFIDENCE
  );
}

function isReviewedZenithIdentityCorrectionRecord(record) {
  const confidence = Number(record?.confidence);
  const rowNumber = Number(
    String(record?.id || '').match(/^reviewed_zenith_(\d{6})_/)?.[1],
  );
  return Boolean(
    record
    && REVIEWED_ZENITH_IDENTITY_CORRECTION_ROWS.has(rowNumber)
    && String(record.brand || '').trim().toLowerCase() === 'rolex'
    && String(record.id || '').startsWith(REVIEWED_ZENITH_RECORD_PREFIX)
    && String(record.source || '') === REVIEWED_ZENITH_SOURCE
    && String(record.model || '').trim()
    && String(record.reference || '').trim()
    && String(record.dial_color || '').trim()
    && String(record.verdict || '').trim().toUpperCase() === 'APPROVED'
    && String(record.listing_status || 'ACTIVE').trim().toUpperCase() === 'ACTIVE'
    && Number.isFinite(confidence)
    && confidence >= MIN_RELEASE_CONFIDENCE
  );
}

function isFullReviewedBrandRelease(value = process.env.PUBLICATION_REFERENCES) {
  return String(value || '').trim().toUpperCase() === FULL_REVIEWED_BRAND_RELEASE;
}

function publicationReferences(value = process.env.PUBLICATION_REFERENCES) {
  // Deployment configuration may restrict this reviewed release, but it may
  // never add a brand/reference pair. Empty or omitted configuration uses the
  // reviewed defaults; malformed or unknown non-empty configuration fails shut.
  const configured = String(value || '').trim();
  if (isFullReviewedBrandRelease(configured)) return [];
  if (!configured) return REVIEWED_RELEASE_REFERENCES.map(entry => ({ ...entry }));
  const requestedKeys = new Set(parsedReferences(configured).map(entry =>
    `${entry.brand.toLowerCase()}::${entry.reference.toUpperCase()}`));
  return REVIEWED_RELEASE_REFERENCES
    .filter(entry => requestedKeys.has(`${entry.brand.toLowerCase()}::${entry.reference.toUpperCase()}`))
    .map(entry => ({ ...entry }));
}

function isPublicationReferenceAllowed(brand, reference, value = process.env.PUBLICATION_REFERENCES) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const exactReference = String(reference || '').trim().toUpperCase();
  if (!normalizedBrand || !exactReference) return false;
  if (normalizedBrand === 'panerai') return isReviewedPaneraiReference(brand, reference);
  if (normalizedBrand === 'zenith') return true;
  if (isFullReviewedBrandRelease(value)) return FULL_REVIEWED_BRANDS.has(normalizedBrand);
  return publicationReferences(value).some(entry => (
    entry.brand.toLowerCase() === normalizedBrand
    && entry.reference.toUpperCase() === exactReference
  ));
}

function isReleaseListingEligible(record, value = process.env.PUBLICATION_REFERENCES) {
  if (isReviewedZenithIdentityCorrectionRecord(record)) return true;
  if (String(record?.brand || '').trim().toLowerCase() === 'panerai') {
    return isReviewedPaneraiReleaseRecord(record);
  }
  if (String(record?.brand || '').trim().toLowerCase() === 'zenith') {
    return isReviewedZenithReleaseRecord(record);
  }
  const storedConfidence = Number(record?.confidence);
  const confidence = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const statuses = [
    record?.listing_status,
    record?.trading_floor_status,
    record?.normalization_status,
  ].filter(Boolean).map(status => String(status).trim().toUpperCase());
  const blockedStatuses = new Set([
    'HIDDEN',
    'REJECTED',
    'DELETED',
    'BUNDLE_CHILD_PENDING_REVIEW',
    'BUNDLE_PENDING_SEPARATION',
    'SUPPRESSED_EXACT_DUPLICATE',
  ]);
  return Boolean(
    record
    && isPublicationReferenceAllowed(record.brand, record.reference, value)
    && String(record.verdict || '').trim().toUpperCase() === 'APPROVED'
    && Number.isFinite(confidence)
    && confidence >= MIN_RELEASE_CONFIDENCE
    && !statuses.some(status => blockedStatuses.has(status))
  );
}

function publicationReferencesForBrand(brand, value = process.env.PUBLICATION_REFERENCES) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  if (normalizedBrand === 'panerai') return [...REVIEWED_PANERAI_REFERENCES];
  if (normalizedBrand === 'zenith') return [];
  return publicationReferences(value)
    .filter(entry => entry.brand.toLowerCase() === normalizedBrand)
    .map(entry => entry.reference);
}

function publicationReferencePostgrestFilter(value = process.env.PUBLICATION_REFERENCES) {
  const references = [...new Set(publicationReferences(value).map(entry => entry.reference))];
  if (!references.length) return null;
  return `in.(${references.map(reference => `"${reference.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  FULL_REVIEWED_BRAND_RELEASE,
  FULL_REVIEWED_BRANDS,
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_PANERAI_RECORD_PREFIX,
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_REFERENCES,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_PREFIX,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_IDENTITY_CORRECTION_ROWS,
  REVIEWED_ZENITH_SOURCE,
  THREE_WATCH_RELEASE_REFERENCES,
  isFullReviewedBrandRelease,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
  isReviewedReleaseReference,
  isReviewedPaneraiReference,
  isReviewedPaneraiReleaseRecord,
  isReviewedZenithIdentityCorrectionRecord,
  isReviewedZenithReleaseRecord,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
};
