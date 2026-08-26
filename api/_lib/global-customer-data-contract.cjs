'use strict';

const contract = require('../../config/watchfacts-global-customer-data-contract.json');
const GENERIC_POSTING_IDENTITIES = new Set(contract.dealer_identity.generic_placeholders
  .map(item => item.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));

function clean(value) {
  const text = String(value ?? '').trim();
  return text && !/^(?:unknown|null|undefined|n\/a)$/i.test(text) ? text : '';
}

function cleanPostingIdentity(value) {
  const text = clean(value);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return text && !GENERIC_POSTING_IDENTITIES.has(normalized)
    && !/^(?:anonymous|unknown)(?: user| seller| dealer| poster)?$/.test(normalized)
    && !/^(?:seller|dealer)(?: name)? (?:not available|unavailable|not supplied)$/.test(normalized)
    ? text
    : '';
}

function canonicalReferenceKey(brand, reference) {
  return `${clean(brand).toUpperCase()}|${clean(reference).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

function resolvePostingIdentity(record = {}) {
  for (const field of contract.dealer_identity.priority) {
    const name = cleanPostingIdentity(record[field]);
    if (name) return { name, source: field };
  }
  return null;
}

function postingIdentityStatus(record = {}) {
  return resolvePostingIdentity(record)
    ? 'RESOLVED'
    : contract.dealer_identity.review_status;
}

function priceEvidenceDisposition(classification) {
  const value = clean(classification).toUpperCase();
  if (contract.price_currency_evidence.qualified_classes.includes(value)) return 'QUALIFIED';
  return contract.price_currency_evidence.review_only_classes.includes(value) ? 'REVIEW_ONLY' : 'UNRESOLVED';
}

function referenceIdentityDisposition(record = {}) {
  const reference = clean(record.observed_reference || record.reference || record.normalized_reference);
  const classification = clean(record.reference_identity_classification || record.child_classification).toUpperCase();
  const catalogStatus = clean(record.catalog_status).toUpperCase();
  if (!reference || /(?:PARTIAL|AMBIGUOUS|INVALID|COMPONENT|FRAGMENT|REVIEW_REQUIRED)/.test(classification)) {
    return 'REVIEW_ONLY';
  }
  if (catalogStatus === 'CATALOG_CONFIRMED') return 'CATALOG_CONFIRMED';
  const sourceBacked = record.live_source_verified === true
    || classification === 'SOURCE_BACKED_OBSERVED_REFERENCE'
    || catalogStatus === 'OBSERVED_ONLY'
    || (clean(record.raw_occurrence_key) && clean(record.exact_child_text_sha256));
  return sourceBacked ? 'OBSERVED_ONLY' : 'REVIEW_ONLY';
}

function isContractBrand(brand) {
  const value = clean(brand).toLowerCase();
  return contract.brands.some(candidate => candidate.toLowerCase() === value);
}

module.exports = {
  canonicalReferenceKey,
  contract,
  isContractBrand,
  priceEvidenceDisposition,
  referenceIdentityDisposition,
  postingIdentityStatus,
  resolvePostingIdentity,
};
