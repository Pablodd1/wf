'use strict';

const contract = require('../../config/watchfacts-global-customer-data-contract.json');

function clean(value) {
  const text = String(value ?? '').trim();
  return text && !/^(?:unknown|null|undefined|n\/a)$/i.test(text) ? text : '';
}

function cleanPostingIdentity(value) {
  const text = clean(value);
  return text && !/^(?:anonymous|source dealer|source poster|dealer profile|seller not supplied)$/i.test(text)
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

function priceEvidenceDisposition(classification) {
  const value = clean(classification).toUpperCase();
  if (contract.price_currency_evidence.qualified_classes.includes(value)) return 'QUALIFIED';
  return contract.price_currency_evidence.review_only_classes.includes(value) ? 'REVIEW_ONLY' : 'UNRESOLVED';
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
  resolvePostingIdentity,
};
