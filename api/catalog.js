/**
 * GET /api/catalog?reference=5711&brand=Patek&limit=10
 * Cross-reference catalog lookups
 */
const fs = require('fs');
const path = require('path');

// JASS-6 Phase 0 short→full map. require() (not fs.readFileSync) so Vercel's
// serverless bundler statically includes the JSON in the function bundle.
let shortrefMap = {};
try {
  shortrefMap = require('./_lib/shortref-map.json');
} catch (e) {
  shortrefMap = {};
}

let catalog = null;
function loadCatalog() {
  if (!catalog) {
    const p = path.join(process.cwd(), 'public', 'catalog.json');
    catalog = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return catalog;
}

function normalizeRef(ref) {
  return ref.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1]
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1] + 1, matrix[i][j-1] + 1, matrix[i-1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { reference, brand, dial, limit = 10 } = req.query;
    const cat = loadCatalog();
    let results = [];
    
    if (reference) {
      const normRef = normalizeRef(reference);
      // Exact match
      const exact = cat.filter(c => normalizeRef(c.reference) === normRef);
      results = exact;

      // JASS-6 Phase 0 short→full fold: BEFORE fuzzy, try the unambiguous map.
      // Resolves "116500" → "116500LN" deterministically instead of letting
      // levenshtein grab a wrong sibling (116503). Map is brand-scoped.
      if (!exact.length && brand) {
        const mapKey = `${brand.toUpperCase().trim()}|${normRef}`;
        const fullRef = shortrefMap[mapKey];
        if (fullRef) {
          const folded = cat.filter(c => normalizeRef(c.reference) === normalizeRef(fullRef));
          if (folded.length) results = folded;
        }
      }

      // Fuzzy match if still nothing
      if (!results.length) {
        results = cat
          .map(c => ({ ...c, distance: levenshtein(normRef, normalizeRef(c.reference)) }))
          .filter(c => c.distance <= 3)
          .sort((a, b) => a.distance - b.distance)
          .map(({ distance, ...c }) => c);
      }
    } else if (brand) {
      results = cat.filter(c => c.brand.toLowerCase().includes(brand.toLowerCase()));
    }
    
    if (dial) {
      results = results.filter(c => c.dialColor && c.dialColor.toLowerCase().includes(dial.toLowerCase()));
    }
    
    const limited = results.slice(0, parseInt(limit));
    
    res.status(200).json({
      query: { reference, brand, dial },
      total: results.length,
      results: limited,
      match: limited.length > 0 ? (normalizeRef(limited[0].reference) === normalizeRef(reference || '') ? 'exact' : 'fuzzy') : 'none',
    });
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
