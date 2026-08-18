/**
 * Customer-safe release counts for Price Research discovery.
 * Counts only the same reviewed, globally deduplicated cache used by Trading
 * Floor. It deliberately does not count the narrower Price Research cohort.
 */
const { getClient } = require('./_lib/supabase');
const { publicationBrands } = require('./_lib/publication-brands.cjs');
const {
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');
const { repostSignature } = require('./_lib/repost-deduplication.cjs');
const { buildLuxuryResearchCoverage } = require('./_lib/luxury-research-coverage.cjs');
const { loadReviewedWorkbookBrandCount } = require('./_lib/reviewed-workbook-browse.cjs');

const DEFAULT_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Panerai', 'Zenith'];
const QNSA_MARKET_SOURCE = 'qnsa_rolex_patek_trading_floor_source';
const CACHE_TTL_MS = 60 * 1000;
let cached = null;

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function loadQnsaSummary(client) {
  const { data, error } = await client.rpc('qnsa_market_feed_counts');
  if (error) throw error;
  const watchRows = (data || []).filter(row => String(row.category || '').toUpperCase() === 'WATCH');
  const luxuryCoverage = buildLuxuryResearchCoverage(data || []);
  const brands = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'].map(brand => ({
    brand,
    listing_count: watchRows
      .filter(row => String(row.brand || '').toLowerCase() === brand.toLowerCase())
      .reduce((sum, row) => sum + Number(row.row_count || 0), 0),
  }));
  const admittedWorkbookBrandNames = [
      'A. Lange & Söhne', 'Bell & Ross', 'Blancpain', 'Breguet', 'Breitling',
      'Bulgari', 'Chopard', 'F.P. Journe', 'Franck Muller',
      'Girard-Perregaux', 'Glashütte Original', 'Grand Seiko', 'H. Moser & Cie',
      'Hublot', 'IWC', 'Jacob & Co', 'Jaeger-LeCoultre', 'Longines', 'Omega',
      'TAG Heuer', 'Ulysse Nardin',
  ];
  const admittedWorkbookBrands = await mapWithConcurrency(
    admittedWorkbookBrandNames,
    3,
    async brand => {
      try {
        return {
          brand,
          listing_count: await loadReviewedWorkbookBrandCount(client, brand),
          count_status: 'exact',
        };
      } catch {
        return { brand, listing_count: 0, count_status: 'unavailable' };
      }
    },
  );
  brands.push(...admittedWorkbookBrands.filter(item => item.listing_count > 0));
  return {
    success: true,
    surface: 'Trading Floor',
    category: 'WATCH',
    brands,
    total_listing_count: brands.reduce((total, brand) => total + brand.listing_count, 0),
    luxury_categories: luxuryCoverage.categories,
    total_luxury_item_count: luxuryCoverage.total_listing_count,
    count_source: 'qnsa_market_feed_counts_plus_reviewed_workbook_admissions',
  };
}

async function loadControlledRows(client, brand) {
  const columns = 'id,brand,reference,dial_color,condition,price_usd,dealer_id,raw_message,source,verdict,confidence,listing_type,listing_status';
  if (brand === 'Panerai') {
    const { data, error } = await client
      .from('watch_records')
      .select(columns)
      .in('id', REVIEWED_PANERAI_RECORD_IDS)
      .eq('source', REVIEWED_PANERAI_SOURCE)
      .eq('brand', 'Panerai');
    if (error) throw error;
    return data || [];
  }

  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('watch_records')
      .select(columns)
      .gte('id', REVIEWED_ZENITH_RECORD_START)
      .lt('id', REVIEWED_ZENITH_RECORD_END)
      .eq('source', REVIEWED_ZENITH_SOURCE)
      .eq('brand', 'Zenith')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadSummary() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;
  const client = getClient();
  if (String(process.env.TRADING_FLOOR_SOURCE_VIEW || '').trim() === QNSA_MARKET_SOURCE) {
    const payload = await loadQnsaSummary(client);
    cached = { at: Date.now(), payload };
    return payload;
  }
  const configuredBrands = publicationBrands();
  const brands = configuredBrands.length ? configuredBrands : DEFAULT_BRANDS;
  const reviewedReleaseCache = process.env.THREE_BRAND_RELEASE_CACHE === 'true'
    ? 'three_brand_verified_trading_release_cache'
    : 'two_brand_verified_trading_release_cache';
  const results = await Promise.all(brands.map(async brand => {
    if (['Panerai', 'Zenith'].includes(brand)) {
      const rows = (await loadControlledRows(client, brand))
        .filter(isReleaseListingEligible);
      return {
        brand,
        listing_count: new Set(rows.map(repostSignature)).size,
      };
    }
    const query = client
      .from(reviewedReleaseCache)
      .select('id', { count: 'exact', head: true })
      .eq('brand', brand);
    const { count, error } = await query;
    if (error) throw error;
    return { brand, listing_count: Number(count || 0) };
  }));
  const payload = {
    success: true,
    surface: 'Trading Floor',
    brands: results,
    total_listing_count: results.reduce((total, brand) => total + brand.listing_count, 0),
  };
  cached = { at: Date.now(), payload };
  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    return res.status(200).json(await loadSummary());
  } catch (error) {
    console.error('[live-release-summary] error:', error.message);
    return res.status(503).json({ error: 'Live release counts are temporarily unavailable' });
  }
};

module.exports.loadSummary = loadSummary;
