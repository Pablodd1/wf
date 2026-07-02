const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const client = getClient();

    // Count each verdict separately — avoid .group() which isn't in this client version
    const verdicts = ['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'];
    const counts = {};

    for (const v of verdicts) {
      const { count, error } = await client
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .eq('verdict', v);
      counts[v] = error ? 0 : count;
    }

    res.status(200).json({
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      verdictCounts: counts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
