'use strict';

function normalizePublicationReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function publicationReferences(value = process.env.PUBLICATION_REFERENCES) {
  return [...new Map(String(value || '')
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const separator = entry.indexOf('::');
      const brand = separator >= 0 ? entry.slice(0, separator).trim() : '';
      const reference = separator >= 0 ? entry.slice(separator + 2).trim() : entry;
      const normalizedReference = normalizePublicationReference(reference);
      return [`${brand.toLowerCase()}::${normalizedReference}`, {
        brand,
        reference,
        normalizedReference,
      }];
    })
    .filter(([, entry]) => entry.normalizedReference)).values()];
}

function isPublicationReferenceAllowed(brand, reference, value = process.env.PUBLICATION_REFERENCES) {
  const allowed = publicationReferences(value);
  if (!allowed.length) return true;
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const normalizedReference = normalizePublicationReference(reference);
  return allowed.some(entry =>
    (!entry.brand || entry.brand.toLowerCase() === normalizedBrand)
    && entry.normalizedReference === normalizedReference);
}

function publicationReferencesForBrand(brand, value = process.env.PUBLICATION_REFERENCES) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  return publicationReferences(value)
    .filter(entry => !entry.brand || entry.brand.toLowerCase() === normalizedBrand)
    .map(entry => entry.reference);
}

function publicationReferencePostgrestFilter(value = process.env.PUBLICATION_REFERENCES) {
  const references = [...new Set(publicationReferences(value).map(entry => entry.reference))];
  if (!references.length) return null;
  return `in.(${references.map(reference => `"${reference.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  isPublicationReferenceAllowed,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
};
