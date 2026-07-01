/**
 * GET /api/confidence-stats
 * Serves from precomputed watchfacts-stats.json.
 * Instant, no database queries.
 */

const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, '..', 'public', 'watchfacts-stats.json');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    // Normalize field names — some consumers expect `total`, others `totalRecords`
    if (stats.totalRecords && !stats.total) stats.total = stats.totalRecords;
    if (stats.total && !stats.totalRecords) stats.totalRecords = stats.total;
    res.status(200).json(stats);
  } catch (err) {
    // Fallback: return hardcoded last-known values
    res.status(200).json({
      exportDate: '2026-07-01',
      total: 2392784,
      totalRecords: 2392784,
      verdictCounts: {
        APPROVED: 1084269,
        REVIEW: 769921,
        HUMAN: 267215,
        RECYCLE: 271379,
      },
      _error: err.message,
    });
  }
};
