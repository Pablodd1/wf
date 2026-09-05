'use strict';

const { lookupCatalog, normalizeRef } = require('./catalog.js');
const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');

function normalizeBrand(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function compactIdentityEvidence(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function rawSupportsExactReference(rawMessage, reference) {
  const raw = compactIdentityEvidence(rawMessage);
  const exactReference = compactIdentityEvidence(reference);
  return Boolean(raw && exactReference && raw.includes(exactReference));
}

function rawSupportsReferenceToken(rawMessage, reference) {
  const raw = String(rawMessage || '').toUpperCase();
  const parts = String(reference || '').toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!raw || !parts.length) return false;
  const pattern = parts
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^A-Z0-9]*');
  return new RegExp(`(?<![A-Z0-9])${pattern}(?![A-Z0-9]|\\s*[-/\\\\]\\s*[A-Z0-9])`, 'u').test(raw);
}

function confirmCatalogCandidate(candidate) {
  if (!candidate?.reference) {
    return { confirmed: false, reason: 'CATALOG_IDENTITY_INCOMPLETE', match: null };
  }

  let match = lookupCatalog(candidate.reference, candidate.brand || null);
  if (!match.found && candidate.brand) {
    const unqualified = lookupCatalog(candidate.reference);
    if (unqualified.found && unqualified.brand
      && normalizeBrand(unqualified.brand) !== normalizeBrand(candidate.brand)) {
      match = unqualified;
    }
  }
  if (!match.found) return { confirmed: false, reason: 'CATALOG_NOT_FOUND', match };
  if (!['exact', 'exact_alias', 'collapsed'].includes(match.matchType)) {
    return { confirmed: false, reason: 'CATALOG_PARTIAL_MATCH', match };
  }
  if (match.brand && candidate.brand && normalizeBrand(match.brand) !== normalizeBrand(candidate.brand)) {
    return { confirmed: false, reason: 'CATALOG_BRAND_CONFLICT', match };
  }

  const proposedDial = normalizeDialValue(candidate.dial_color);
  const catalogDials = uniqueCatalogDials(match.dialColors || []);
  let dialConfirmed = null;
  let dialReason = null;
  let canonicalDial = null;
  if (proposedDial.known) {
    const proposedDialKey = comparisonKey(proposedDial.value);
    canonicalDial = catalogDials.find(value => comparisonKey(value) === proposedDialKey) || null;
    dialConfirmed = Boolean(canonicalDial);
    dialReason = dialConfirmed
      ? 'CATALOG_DIAL_CONFIRMED'
      : (catalogDials.length ? 'CATALOG_DIAL_CONFLICT' : 'CATALOG_DIAL_UNCONFIRMED');
  }

  return {
    confirmed: true,
    reason: 'CATALOG_CONFIRMED',
    dialConfirmed,
    dialReason,
    canonicalDial,
    match: {
      reference: normalizeRef(match.matchedRef || candidate.reference),
      brand: match.brand || candidate.brand,
      source: match.source,
      matchType: match.matchType,
      collection: match.collection || null,
      model: match.model || null,
      dialColors: catalogDials,
    },
  };
}

module.exports = {
  compactIdentityEvidence,
  confirmCatalogCandidate,
  rawSupportsExactReference,
  rawSupportsReferenceToken,
};
