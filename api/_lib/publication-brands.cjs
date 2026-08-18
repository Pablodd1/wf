'use strict';

const CONTROLLED_FILE_RELEASE_BRANDS = [
  'A. Lange & Söhne',
  'Audemars Piguet',
  'Bell & Ross',
  'Blancpain',
  'Breguet',
  'Bulgari',
  'Breitling',
  'Bvlgari',
  'Cartier',
  'Chopard',
  'F.P. Journe',
  'Franck Muller',
  'Girard-Perregaux',
  'Glashütte Original',
  'Grand Seiko',
  'Greubel Forsey',
  'H. Moser & Cie',
  'Hublot',
  'IWC',
  'Jacob & Co',
  'Jaeger-LeCoultre',
  'MB&F',
  'Omega',
  'Panerai',
  'Patek Philippe',
  'Piaget',
  'Richard Mille',
  'Roger Dubuis',
  'Rolex',
  'TAG Heuer',
  'Tudor',
  'Ulysse Nardin',
  'Vacheron Constantin',
  'Zenith',
];

function publicationBrands(value = process.env.PUBLICATION_BRANDS) {
  const configured = String(value || '')
    .split(/[|,]/)
    .map(brand => brand.trim())
    .filter(Boolean);
  const unique = new Map();
  for (const brand of [...configured, ...CONTROLLED_FILE_RELEASE_BRANDS]) {
    const key = brand.toLowerCase();
    if (!unique.has(key)) unique.set(key, brand);
  }
  return [...unique.values()];
}

function isPublicationBrandAllowed(brand, value = process.env.PUBLICATION_BRANDS) {
  const normalized = String(brand || '').trim().toLowerCase();
  return Boolean(normalized) && publicationBrands(value)
    .some(allowed => allowed.toLowerCase() === normalized);
}

function publicationBrandPostgrestFilter(value = process.env.PUBLICATION_BRANDS) {
  const brands = publicationBrands(value);
  if (!brands.length) return null;
  return `in.(${brands.map(brand => `"${brand.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  CONTROLLED_FILE_RELEASE_BRANDS,
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
};
