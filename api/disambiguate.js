/**
 * REFERENCE DISAMBIGUATION API
 * POST/GET /api/disambiguate
 *
 * Resolves partial/ambiguous references to their canonical full form
 * using frequency data from the 117K approved dataset.
 *
 * POST body: { reference: string }
 * GET ?reference=...
 * Response: {
 *   success, original, resolved, confidence,
 *   canonical: { reference, frequency, model?, brand? },
 *   alternatives: [{reference, frequency}]
 * }
 */

let _cache = null;
let _cachePromise = null;

function loadMap() {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;

  const fs = require('fs');
  const path = require('path');
  const MAP_PATH = path.resolve(process.cwd(), 'public', 'disambiguation_map.json');
  try {
    const raw = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    _cache = {
      prefix: raw.canonical_prefix || {},
      whitespace: raw.whitespace_normalized || {},
      counts: raw.full_ref_counts || {},
    };
  } catch (e) {
    console.error('[disambiguate] Failed to load map:', e.message);
    _cache = { prefix: {}, whitespace: {}, counts: {} };
  }
  return _cache;
}

// Normalize: strip whitespace, uppercase
function normalize(ref) {
  return String(ref || '').toUpperCase().replace(/\s+/g, '').trim();
}

// Try to resolve a ref by trying progressively shorter prefixes
function resolveByPrefix(ref, map, counts) {
  // Direct prefix match (e.g., "126331" → "126331G")
  if (map[ref]) {
    const target = map[ref];
    return {
      resolved: target,
      frequency: counts[target] || 0,
      method: 'prefix_map',
      confidence: 0.95,
    };
  }

  // Whitespace normalized (e.g., "126331 G" → "126331G")
  const norm = normalize(ref);
  if (map.whitespace && map.whitespace[norm]) {
    const target = map.whitespace[norm];
    return {
      resolved: target,
      frequency: counts[target] || 0,
      method: 'whitespace_normalize',
      confidence: 0.95,
    };
  }

  // Find all refs starting with this prefix
  const allRefs = Object.keys(counts);
  const matches = allRefs.filter(r => r.startsWith(ref) && r !== ref);
  if (matches.length === 0) {
    // No prefix match — try matching original with whitespace removed
    return null;
  }

  // Sort by frequency
  matches.sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const top = matches[0];
  const topCount = counts[top] || 0;
  const totalCount = matches.reduce((sum, m) => sum + (counts[m] || 0), 0);

  // Confidence based on dominance
  const dominance = topCount / totalCount;
  if (dominance > 0.6 && topCount >= 10) {
    return {
      resolved: top,
      frequency: topCount,
      method: 'frequency_dominant',
      confidence: Math.min(0.95, 0.5 + dominance * 0.5),
    };
  }

  return {
    resolved: top,
    frequency: topCount,
    method: 'frequency_best_guess',
    confidence: Math.max(0.3, dominance * 0.7),
    alternatives: matches.slice(0, 5).map(m => ({
      reference: m,
      frequency: counts[m] || 0,
    })),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const map = loadMap();

  // Extract reference from query (GET) or body (POST)
  let reference;
  if (req.method === 'GET') {
    reference = req.query?.reference || req.query?.ref;
  } else if (req.method === 'POST') {
    const body = req.body || {};
    reference = body.reference || body.ref;
  }

  if (!reference) {
    return res.status(400).json({
      success: false,
      error: 'reference query/body param required',
      example: 'GET /api/disambiguate?reference=126331',
    });
  }

  const original = String(reference).trim().toUpperCase();

  // If exact match in counts, return immediately
  if (map.counts[original]) {
    return res.status(200).json({
      success: true,
      original,
      resolved: original,
      confidence: 1.0,
      method: 'exact_match',
      frequency: map.counts[original],
      alternatives: [],
    });
  }

  // Try prefix + whitespace resolution
  const resolution = resolveByPrefix(original, map, map.counts);

  if (!resolution) {
    return res.status(200).json({
      success: true,
      original,
      resolved: null,
      confidence: 0,
      method: 'no_match',
      alternatives: [],
    });
  }

  return res.status(200).json({
    success: true,
    ...resolution,
  });
};
