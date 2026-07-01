/**
 * GET /api/listings
 * Fast static export version — serves from precomputed JSON.
 * No database queries. No timeouts. Instant.
 *
 * Query params: page, limit, brand, reference, verdict, search
 */

const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, '..', 'public', 'watchfacts-stats.json');
const EXPORT_PATH = path.join(__dirname, '..', 'public', 'watchfacts-export.json');
const BRAND_INDEX_PATH = path.join(__dirname, '..', 'public', 'watchfacts-brand-index.json');

let cachedData = null;
let cachedBrandIndex = null;
let cachedStats = null;

function loadCache() {
  if (!cachedData) {
    try { cachedData = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8')); }
    catch { cachedData = []; }
  }
  if (!cachedBrandIndex) {
    try { cachedBrandIndex = JSON.parse(fs.readFileSync(BRAND_INDEX_PATH, 'utf8')); }
    catch { cachedBrandIndex = {}; }
  }
  if (!cachedStats) {
    try { cachedStats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); }
    catch { cachedStats = { totalRecords: 0 }; }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    loadCache();

    const { page = '1', limit = '50', brand, reference, verdict, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 50));

    let filtered = cachedData || [];

    // Filters
    if (brand) {
      const b = brand.toLowerCase();
      filtered = filtered.filter(r => r.brand && r.brand.toLowerCase().includes(b));
    }
    if (reference) {
      const ref = reference.toLowerCase();
      filtered = filtered.filter(r => r.reference && r.reference.toLowerCase().includes(ref));
    }
    if (verdict) {
      filtered = filtered.filter(r => r.verdict === verdict);
    }
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(r => 
        (r.brand && r.brand.toLowerCase().includes(s)) ||
        (r.reference && r.reference.toLowerCase().includes(s)) ||
        (r.raw_message && r.raw_message.toLowerCase().includes(s))
      );
    }

    // Sort by created_at desc
    filtered.sort((a, b) => {
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      return b.created_at.localeCompare(a.created_at);
    });

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const rows = filtered.slice(start, start + limitNum);

    res.status(200).json({ rows, total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(200).json({ rows: [], total: 0, error: err.message, demo: true });
  }
};
