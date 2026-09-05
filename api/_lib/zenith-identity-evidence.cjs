'use strict';

// Zenith references in the immutable source commonly follow a dotted form,
// including alpha segments (for example 03.A384.400/385.C855).  A leading
// inventory number is not a watch reference and must never win identity.
const ZENITH_REFERENCE_PATTERN = /\b\d{2}\.[A-Z0-9]{3,4}\.[A-Z0-9]{3,4}(?:-\d)?(?:\/[A-Z0-9]+)?(?:\.[A-Z0-9]+)?\b/gi;
const FOREIGN_IDENTITY_PATTERN = /\b(?:DAYTONA|ROLEX|PATEK(?:\s+PHILIPPE)?|BREITLING|AUDEMARS(?:\s+PIGUET)?|RICHARD\s+MILLE|CARTIER)\b/i;

function extractZenithReferences(rawMessage) {
  return [...new Set((String(rawMessage || '').match(ZENITH_REFERENCE_PATTERN) || [])
    .map(value => value.toUpperCase()))].sort();
}

function classifyZenithIdentityEvidence(rawMessage) {
  const references = extractZenithReferences(rawMessage);
  const hasForeignIdentity = FOREIGN_IDENTITY_PATTERN.test(String(rawMessage || ''));
  if (hasForeignIdentity) {
    return { decision: 'QUARANTINE', reason: 'CROSS_BRAND_OR_DAYTONA', references };
  }
  if (references.length === 0) {
    return { decision: 'QUARANTINE', reason: 'NO_EXACT_ZENITH_REFERENCE', references };
  }
  if (references.length > 1) {
    return { decision: 'QUARANTINE', reason: 'MULTIPLE_ZENITH_REFERENCES', references };
  }
  return { decision: 'RELEASE_SAFE', reason: 'ONE_EXACT_ZENITH_REFERENCE', references };
}

module.exports = {
  ZENITH_REFERENCE_PATTERN,
  classifyZenithIdentityEvidence,
  extractZenithReferences,
};
