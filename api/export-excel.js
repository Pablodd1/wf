const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { brand, reference, verdict = 'APPROVED' } = req.body;

  try {
    let query = getClient()
      .from('watch_records')
      .select('*')
      .eq('verdict', verdict)
      .limit(5000);

    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.eq('reference', reference);

    const { data, error } = await query;
    if (error) throw error;

    // Simple CSV export
    const headers = ['id', 'brand', 'reference', 'dial_color', 'condition', 'price_usd', 'confidence', 'verdict', 'source', 'created_at'];
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        const val = row[h];
        if (val == null) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') ? `"${str}"` : str;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="watchfacts-export.csv"');
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
