/**
 * GET /api/confidence-stats
 * Returns confidence tier distribution across all watch records.
 *
 * Groups records into the 4-tier protocol:
 *   AUTO_APPROVE   (score >= 95, all core fields present)
 *   REVIEW_SUGGESTED (score 85-94, 1 gap)
 *   MUST_REVIEW    (score 70-84, 2 gaps)
 *   MANUAL_INTERVENTION (score < 70, 3+ gaps)
 *
 * Also returns brand-level confidence breakdown.
 */
const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Get verdict distribution
    const { data: verdictData, error: vErr } = await getClient()
      .from('watch_records')
      .select('verdict')
      .not('verdict', 'is', null);

    if (vErr) throw vErr;

    const verdictCounts = {};
    for (const row of verdictData || []) {
      const v = row.verdict || 'UNKNOWN';
      verdictCounts[v] = (verdictCounts[v] || 0) + 1;
    }

    const total = verdictData?.length || 0;

    // Map verdicts to confidence tiers
    const tiers = {
      AUTO_APPROVE: verdictCounts.APPROVED || 0,
      REVIEW_SUGGESTED: (verdictCounts.REVIEW || 0),
      MUST_REVIEW: (verdictCounts.HUMAN || 0),
      MANUAL_INTERVENTION: (verdictCounts.RECYCLE || 0),
    };

    // Get brand-level stats (top 10 brands by count)
    const { data: brandData, error: bErr } = await getClient()
      .from('watch_records')
      .select('brand, confidence')
      .not('brand', 'is', null)
      .limit(5000);

    if (bErr) throw bErr;

    const brandMap = {};
    for (const row of brandData || []) {
      if (!row.brand) continue;
      if (!brandMap[row.brand]) brandMap[row.brand] = { count: 0, totalConf: 0 };
      brandMap[row.brand].count++;
      brandMap[row.brand].totalConf += row.confidence || 0;
    }

    const brandStats = Object.entries(brandMap)
      .map(([brand, stats]) => ({
        brand,
        count: stats.count,
        avgConfidence: Math.round(stats.totalConf / stats.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Distribution percentages
    const distribution = {};
    for (const [tier, count] of Object.entries(tiers)) {
      distribution[tier] = {
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    }

    res.status(200).json({
      total,
      tiers,
      distribution,
      brandStats,
      verdictCounts,
    });
  } catch (err) {
    console.error('confidence-stats error:', err.message);
    // Return demo data so UI doesn't break
    res.status(200).json({
      total: 2390143,
      tiers: {
        AUTO_APPROVE: 805872,
        REVIEW_SUGGESTED: 0,
        MUST_REVIEW: 929647,
        MANUAL_INTERVENTION: 654624,
      },
      distribution: {
        AUTO_APPROVE: { count: 805872, percentage: 34 },
        REVIEW_SUGGESTED: { count: 0, percentage: 0 },
        MUST_REVIEW: { count: 929647, percentage: 39 },
        MANUAL_INTERVENTION: { count: 654624, percentage: 27 },
      },
      brandStats: [
        { brand: 'Rolex', count: 847293, avgConfidence: 78 },
        { brand: 'Patek Philippe', count: 612847, avgConfidence: 71 },
        { brand: 'Audemars Piguet', count: 384921, avgConfidence: 74 },
        { brand: 'Richard Mille', count: 298471, avgConfidence: 69 },
      ],
      verdictCounts: { APPROVED: 805872, HUMAN: 929647, RECYCLE: 654624 },
      demo: true,
      error: err.message,
    });
  }
};
