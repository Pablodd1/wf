/**
 * GET /api/confidence-stats
 * Returns confidence tier distribution across all watch records.
 *
 * Uses mv_verdict_dist materialized view (4 rows, instant) instead of
 * scanning 2.39M rows. Brand stats use a 5000-row sample with date filter.
 *
 * 1-year filter: only counts records from the last 365 days.
 */
const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getClient();

    // 1-year date filter
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString();

    // ─── Verdict distribution from materialized view (instant) ───
    const { data: verdictData, error: vErr } = await db
      .from('mv_verdict_dist')
      .select('*');

    if (vErr) throw vErr;

    const verdictCounts = {};
    let total = 0;
    for (const row of verdictData || []) {
      verdictCounts[row.verdict] = row.count;
      total += row.count;
    }

    // Map verdicts to confidence tiers
    const tiers = {
      AUTO_APPROVE: verdictCounts.APPROVED || 0,
      REVIEW_SUGGESTED: verdictCounts.REVIEW || 0,
      MUST_REVIEW: verdictCounts.HUMAN || 0,
      MANUAL_INTERVENTION: verdictCounts.RECYCLE || 0,
    };

    // ─── Brand-level stats (sampled, with 1-year filter) ───
    const { data: brandData, error: bErr } = await db
      .from('watch_records')
      .select('brand, confidence')
      .not('brand', 'is', null)
      .gte('created_at', cutoff)
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
      dateRange: { cutoff, note: '1-year filter applied to brand stats' },
    });
  } catch (err) {
    console.error('confidence-stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
