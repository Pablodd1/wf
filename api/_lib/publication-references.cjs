'use strict';

const THREE_WATCH_RELEASE_REFERENCES = [
  'Rolex::116610LN',
  'Patek Philippe::5712/1A',
  'Patek Philippe::5712/1A-001',
  'Rolex::126710BLNR',
].join('|');

function normalizePublicationReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function publicationReferences(value = process.env.PUBLICATION_REFERENCES) {
  // This release must fail closed even when a deployment omits its environment
  // override. A later reviewed release can replace the exact list explicitly.
  const releaseConfiguration = String(value || '').trim() || THREE_WATCH_RELEASE_REFERENCES;
  return [...new Map(releaseConfiguration
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
  THREE_WATCH_RELEASE_REFERENCES,
  isPublicationReferenceAllowed,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
};
