'use strict';

const { canonicalizeLuxuryBrand } = require('./luxury-item-normalization.cjs');

const CATEGORIES = ['HANDBAG', 'JEWELRY', 'ACCESSORY'];

function buildLuxuryResearchCoverage(rows = []) {
  const sourceRows = rows.filter(row => CATEGORIES.includes(String(row.category || '').toUpperCase()));
  const categories = CATEGORIES.map(category => {
    const categoryRows = sourceRows.filter(row => String(row.category || '').toUpperCase() === category);
    const total = categoryRows.reduce((sum, row) => sum + Number(row.row_count || 0), 0);
    const wtsPriced = categoryRows
      .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS' && row.supplied_price === true)
      .reduce((sum, row) => sum + Number(row.row_count || 0), 0);
    const wtsNoPrice = categoryRows
      .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS' && row.supplied_price !== true)
      .reduce((sum, row) => sum + Number(row.row_count || 0), 0);
    const wtb = categoryRows
      .filter(row => String(row.listing_type || '').toUpperCase() === 'WTB')
      .reduce((sum, row) => sum + Number(row.row_count || 0), 0);
    const brands = [...new Set(categoryRows.map(row => canonicalizeLuxuryBrand(row.brand) || String(row.brand || '').trim()).filter(Boolean))]
      .map(brand => ({
        brand,
        listing_count: categoryRows.filter(row => (canonicalizeLuxuryBrand(row.brand) || String(row.brand || '').trim()) === brand)
          .reduce((sum, row) => sum + Number(row.row_count || 0), 0),
      }))
      .sort((a, b) => b.listing_count - a.listing_count || a.brand.localeCompare(b.brand));
    return { category, listing_count: total, wts_with_price: wtsPriced, wts_without_price: wtsNoPrice, wtb_activity: wtb, brands };
  });
  return {
    categories,
    total_listing_count: categories.reduce((sum, row) => sum + row.listing_count, 0),
  };
}

module.exports = { CATEGORIES, buildLuxuryResearchCoverage };
