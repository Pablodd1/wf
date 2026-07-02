const fs = require('fs');
const path = require('path');
const STATS_PATH = path.join(__dirname, '..', 'public', 'watchfacts-stats.json');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    res.status(200).json(stats);
  } catch (err) {
    res.status(200).json({
      total: 2392784,
      verdictCounts: { APPROVED: 1084269, REVIEW: 769921, HUMAN: 267215, RECYCLE: 271379 }
    });
  }
};
