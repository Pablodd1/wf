/**
 * CATALOG LOOKUP API
 * /api/catalog-lookup
 *
 * Merged catalog: catalog.json (3726 refs from 6 brands) + enriched_refs.json (976 refs)
 * Returns brand, collection, model, liquidity data for any reference.
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const PUBLIC_DIR = resolve(process.cwd(), 'public');

let catalogMap = null;
let enrichedMap = null;

function loadCatalogs() {
  if (catalogMap && enrichedMap) return;

  catalogMap = new Map();
  enrichedMap = new Map();

  try {
    const catalog = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'catalog.json'), 'utf8'));
    for (const item of catalog) {
      const ref = normalizeRef(item.reference);
      catalogMap.set(ref, {
        brand: item.brand || inferBrand(item.reference) || 'Unknown',
        collection: item.collection || item.model,
        model: item.model,
        dialColors: item.dialColor ? [item.dialColor] : [],
        imageUrl: item.imageUrl,
        source: 'catalog',
      });
    }
  } catch (e) {
    console.error('Failed to load catalog.json:', e.message);
  }

  try {
    const enriched = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'enriched_refs.json'), 'utf8'));
    for (const item of enriched) {
      const ref = normalizeRef(item.reference);
      const existing = enrichedMap.get(ref);
      if (!existing) {
        enrichedMap.set(ref, {
          brand: item.brand || 'Patek Philippe',
          collection: item.collection,
          model: item.model,
          caseMetal: item.case_metal,
          productionYears: item.production_years,
          totalMentions: item.total_mentions,
          buyers: item.buyers,
          sellers: item.sellers,
          buyerRatio: item.buyer_ratio,
          sellerRatio: item.seller_ratio,
          avgPrice: item.avg_price,
          minPrice: item.min_price,
          maxPrice: item.max_price,
          liquidityScore: item.liquidity_score,
          source: 'enriched',
        });
      }
    }
  } catch (e) {
    console.error('Failed to load enriched_refs.json:', e.message);
  }
}

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
}

function inferBrand(ref) {
  // Check decimal format BEFORE normalization (dot gets stripped)
  if (/^\d{3}\.\d{3}/.test(ref)) return 'A. Lange & Söhne';
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
  if (/^[45]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^3\d{3}\//.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  if (/^15\d{3}[A-Z]{2}/.test(r) || /^26\d{3}[A-Z]{2}/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^(85|47|49)\d{3}[A-Z\/]/.test(r)) return 'Vacheron Constantin';
  if (/^M\d{5,6}/.test(r)) return 'Tudor';
  if (/^W[0-9A-Z]{4,6}/.test(r)) return 'Cartier';
  if (/^2[01]\d{3}\.[0-9]{2,4}/.test(r)) return 'Omega';
  if (/^SB[GAE][A-Z]{2,4}/.test(r)) return 'Grand Seiko';
  if (/^C?[VW]\d{4,5}/.test(r) || /^WAY|^WAR|^WAS|^WBD|^WBE/.test(r)) return 'TAG Heuer';
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  if (/^1[0-3]\d{3,4}/.test(r)) return 'Bvlgari';
  if (/^5[0-9]{3}[A-Z]|^7[0-9]{3}[A-Z]|^8[0-9]{3}[A-Z]|^9[0-9]{3}[A-Z]/.test(r)) return 'Breguet';
  if (/^A[0-9]{4,5}/.test(r) || /^AB[0-9]{4}/.test(r) || /^EB[0-9]{4}/.test(r)) return 'Breitling';
  if (/^IW[0-9]{4,6}/.test(r)) return 'IWC';
  if (/^BR0?[0-9]{1,2}[-]?[A-Z0-9]{2,8}/i.test(ref)) return 'Bell & Ross';
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  loadCatalogs();

  const { reference } = req.query || {};
  if (!reference) {
    return res.status(400).json({ error: 'reference query param required' });
  }

  const ref = normalizeRef(reference);

  // Try catalog first
  let result = catalogMap.get(ref);

  // Try enriched
  if (!result) {
    result = enrichedMap.get(ref);
  }

  // Try partial match
  if (!result) {
    for (const [key, val] of catalogMap) {
      if (key.startsWith(ref) || ref.startsWith(key)) {
        result = val;
        break;
      }
    }
  }

  if (!result) {
    for (const [key, val] of enrichedMap) {
      if (key.startsWith(ref) || ref.startsWith(key)) {
        result = val;
        break;
      }
    }
  }

  // Brand inference fallback
  const brand = result?.brand || inferBrand(reference);

  return res.status(200).json({
    success:      true,
    reference,
    normalizedRef: ref,
    found:        !!result,
    brand,
    model:        result?.model        || result?.collection || null,
    collection:   result?.collection   || result?.model      || null,
    dialColors:   result?.dialColors   || [],
    imageUrl:     result?.imageUrl     || null,
    productionYears: result?.productionYears || null,
    data:         result || null,
    catalogSize:  catalogMap.size,
    enrichedSize: enrichedMap.size,
  });
}
