/**
 * DAILY REPORT API
 * /api/daily-report
 *
 * Generates automated daily digest for owner.
 * Returns stats, top refs, price changes, issues.
 * Can be called by cron job or Telegram bot.
 */

async function getStats() {
  try {
    const res = await fetch('https://watchfacts-poc.vercel.app/parsedWatches.json');
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];

    let approved = 0, human = 0, recycle = 0;
    let totalPrice = 0, priceCount = 0;
    const brandCounts = {};
    const refCounts = {};

    for (const row of rows) {
      const status = row[10] || '';
      if (status === 'APPROVED') approved++;
      else if (status === 'HUMAN') human++;
      else if (status === 'RECYCLE') recycle++;

      const price = parseFloat(row[4] || 0);
      if (price > 0) { totalPrice += price; priceCount++; }

      const brand = row[1] || 'Unknown';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;

      const ref = row[2] || 'Unknown';
      if (ref !== 'Unknown') refCounts[ref] = (refCounts[ref] || 0) + 1;
    }

    const topRefs = Object.entries(refCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ref, count]) => ({ reference: ref, count }));

    const topBrands = Object.entries(brandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([brand, count]) => ({ brand, count }));

    return {
      total: rows.length,
      approved,
      human,
      recycle,
      avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : 0,
      topRefs,
      topBrands,
      needsReview: human + recycle,
      reviewRate: rows.length > 0 ? Math.round(((human + recycle) / rows.length) * 100) : 0,
    };
  } catch (e) {
    return null;
  }
}

function formatReport(stats) {
  if (!stats) return '\u274c Failed to generate report';

  const lines = [
    `\ud83d\udcca *Curated Luxury Daily Report*`,
    ``,
    `*Database Overview*`,
    `• Total Records: ${stats.total.toLocaleString()}`,
    `• Approved: ${stats.approved.toLocaleString()} (${Math.round((stats.approved/stats.total)*100)}%)`,
    `• Human Review: ${stats.human.toLocaleString()} (${Math.round((stats.human/stats.total)*100)}%)`,
    `• Recycle: ${stats.recycle.toLocaleString()} (${Math.round((stats.recycle/stats.total)*100)}%)`,
    ``,
    `*Needs Attention*`,
    `⚠️ ${stats.needsReview.toLocaleString()} records need review (${stats.reviewRate}%)`,
    ``,
    `*Top References*`,
    ...stats.topRefs.slice(0, 5).map((r, i) => `${i+1}. ${r.reference} — ${r.count} mentions`),
    ``,
    `*Top Brands*`,
    ...stats.topBrands.slice(0, 5).map((b, i) => `${i+1}. ${b.brand} — ${b.count} records`),
    ``,
    `[Open Dashboard](https://watchfacts-poc.vercel.app/#/admin)`,
  ];

  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const stats = await getStats();
  const report = formatReport(stats);

  return res.status(200).json({
    success: true,
    date: new Date().toISOString().split('T')[0],
    stats,
    report,
    reportMarkdown: report,
  });
}
