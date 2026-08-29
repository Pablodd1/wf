'use strict';

const { getClient } = require('./_lib/supabase');
const { listCatalogBrands } = require('./_lib/catalog');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { buildPriceResearchCoverage } = require('./_lib/price-research-coverage.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const client = getClient();
    const { data, error } = await client.rpc('qnsa_market_feed_counts');
    if (error) throw error;
    const catalogBrands = listCatalogBrands().filter(item => isPublicationBrandAllowed(item.brand));
    const coverage = buildPriceResearchCoverage(data || [], catalogBrands);
    return res.status(200).json({
      success: true,
      grain: 'brand',
      count_source: 'qnsa_market_feed_counts',
      ...coverage,
      definitions: {
        trading_floor_listings: 'Released single-watch WTS and WTB observations.',
        wts_with_supplied_price: 'WTS observations with a positive stored price. Exact-reference currency, identity, dial, repost and outlier gates still apply before analytics.',
        wts_without_supplied_price: 'WTS activity retained on Trading Floor but excluded from price calculations.',
        wtb_activity: 'Buyer demand retained separately and never included in WTS price averages.',
        searchable_catalog_references: 'Catalog references available for exact-reference Price Research lookup.',
        reference_scoped_analytics: 'Qualified WTS, repost and 3.0x IQR outlier counts are calculated after selecting an exact reference and are not summed across overlapping families.',
      },
    });
  } catch (error) {
    console.error('[price-research-coverage] error:', error.message);
    return res.status(503).json({ error: 'Market coverage counts are temporarily unavailable' });
  }
};

module.exports.buildPriceResearchCoverage = buildPriceResearchCoverage;
