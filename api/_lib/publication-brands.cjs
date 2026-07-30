'use strict';

const CONTROLLED_FILE_RELEASE_BRANDS = ['Panerai', 'Zenith'];

function publicationBrands(value = process.env.PUBLICATION_BRANDS) {
  const configured = String(value || '')
    .split(/[|,]/)
    .map(brand => brand.trim())
    .filter(Boolean);
  if (!configured.length) return [];
  return [...new Set([
    ...configured,
    ...CONTROLLED_FILE_RELEASE_BRANDS,
  ])];
}

function isPublicationBrandAllowed(brand, value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  if (!allowed.length) return true;
  const normalized = String(brand || '').trim().toLowerCase();
  return allowed.some(candidate => candidate.toLowerCase() === normalized);
}

function publicationBrandPostgrestFilter(value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  if (!allowed.length) return null;
  return `in.(${allowed.map(brand => `"${brand.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  CONTROLLED_FILE_RELEASE_BRANDS,
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
};
