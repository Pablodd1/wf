/** CATALOG BRANDS — /api/catalog-brands */
const { listCatalogBrands, listCatalogReferences } = require('./_lib/catalog');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  isPublicationReferenceAllowed,
  publicationReferences,
} = require('./_lib/publication-references.cjs');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const referenceReleaseConfigured = publicationReferences().length > 0;
    const brands = listCatalogBrands()
      .filter(item => isPublicationBrandAllowed(item.brand))
      .map(item => {
        if (!referenceReleaseConfigured) return item;
        const references = listCatalogReferences(item.brand)
          .filter(entry => isPublicationReferenceAllowed(item.brand, entry.reference));
        return {
          ...item,
          model_count: new Set(references.map(entry => entry.model)).size,
          reference_count: references.length,
        };
      })
      .filter(item => !referenceReleaseConfigured || item.reference_count > 0);
    return res.status(200).json({
      success: true,
      brand_count: brands.length,
      model_count: brands.reduce((sum, item) => sum + item.model_count, 0),
      reference_count: brands.reduce((sum, item) => sum + item.reference_count, 0),
      brands,
    });
  } catch (error) {
    console.error('[catalog-brands] error:', error.message);
    return res.status(500).json({ error: 'Failed to load catalog brands' });
  }
};
