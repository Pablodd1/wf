'use strict';

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function buildPriceResearchCoverage(rows, catalogBrands) {
  const catalogByBrand = new Map((catalogBrands || []).map(item => [
    String(item.brand || '').trim().toLowerCase(),
    { model_count: count(item.model_count), reference_count: count(item.reference_count) },
  ]));
  const grouped = new Map();

  for (const row of rows || []) {
    if (String(row.category || '').trim().toUpperCase() !== 'WATCH') continue;
    const brand = String(row.brand || '').trim();
    const listingType = String(row.listing_type || '').trim().toUpperCase();
    const brandKey = brand.toLowerCase();
    // The normalized staging snapshot can retain malformed historical brand
    // labels (for example model names). Price Research discovery is catalog-
    // backed, so never expose a brand that has no searchable catalog identity.
    if (!brand || !catalogByBrand.has(brandKey) || !['WTS', 'WTB'].includes(listingType)) continue;
    if (!grouped.has(brandKey)) {
      grouped.set(brandKey, {
        brand,
        wts_with_supplied_price: 0,
        wts_without_supplied_price: 0,
        wtb_with_target_price: 0,
        wtb_without_target_price: 0,
      });
    }
    const target = grouped.get(brandKey);
    const supplied = row.supplied_price === true || String(row.supplied_price).toLowerCase() === 'true';
    const key = listingType === 'WTS'
      ? supplied ? 'wts_with_supplied_price' : 'wts_without_supplied_price'
      : supplied ? 'wtb_with_target_price' : 'wtb_without_target_price';
    target[key] += count(row.row_count);
  }

  const brands = [...grouped.entries()].map(([key, value]) => {
    const catalog = catalogByBrand.get(key) || { model_count: 0, reference_count: 0 };
    const wts_activity = value.wts_with_supplied_price + value.wts_without_supplied_price;
    const wtb_activity = value.wtb_with_target_price + value.wtb_without_target_price;
    const trading_floor_listings = wts_activity + wtb_activity;
    return {
      ...value,
      trading_floor_listings,
      wts_activity,
      wtb_activity,
      searchable_catalog_models: catalog.model_count,
      searchable_catalog_references: catalog.reference_count,
      price_research_qualified_wts: null,
      reposts_counted_once: null,
      statistical_outliers: null,
      reference_scoped_analytics: true,
      reconciles: trading_floor_listings
        === value.wts_with_supplied_price
          + value.wts_without_supplied_price
          + value.wtb_with_target_price
          + value.wtb_without_target_price,
    };
  }).sort((left, right) => right.trading_floor_listings - left.trading_floor_listings
    || left.brand.localeCompare(right.brand));

  return {
    brands,
    totals: brands.reduce((totals, brand) => ({
      trading_floor_listings: totals.trading_floor_listings + brand.trading_floor_listings,
      wts_with_supplied_price: totals.wts_with_supplied_price + brand.wts_with_supplied_price,
      wts_without_supplied_price: totals.wts_without_supplied_price + brand.wts_without_supplied_price,
      wtb_activity: totals.wtb_activity + brand.wtb_activity,
      searchable_catalog_references: totals.searchable_catalog_references + brand.searchable_catalog_references,
    }), {
      trading_floor_listings: 0,
      wts_with_supplied_price: 0,
      wts_without_supplied_price: 0,
      wtb_activity: 0,
      searchable_catalog_references: 0,
    }),
  };
}

module.exports = { buildPriceResearchCoverage };
