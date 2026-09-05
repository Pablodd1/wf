/** Brand-aware catalog lookup API: /api/catalog-lookup?reference=52508&brand=Rolex */
const { lookupCatalog, normalizeRef, catalogStats } = require('./_lib/catalog');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const reference = String(req.query?.reference || '').trim();
  const brand = String(req.query?.brand || '').trim();
  if (!reference) return res.status(400).json({ error: 'reference query param required' });

  const result = lookupCatalog(reference, brand || null);
  const stats = catalogStats();
  return res.status(200).json({
    success: true,
    reference,
    normalizedRef: normalizeRef(reference),
    found: result.found,
    brand: result.brand,
    data: result.found ? result : null,
    reason: result.found ? null : result.matchType,
    candidates: result.candidates || [],
    catalogSize: stats.catalog,
    enrichedSize: stats.enriched,
    localSourceSize: stats.localSource,
  });
};
