const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    brand,
    reference,
    verdict = 'APPROVED',
    limit = 50,
    page = 1,
    search,
    sort = 'created_at',
    order = 'desc'
  } = req.query;

  try {
    const client = getClient();
    const pageSize = Math.min(parseInt(limit), 100);
    const from = (parseInt(page) - 1) * pageSize;

    // Use a targeted query — NEVER count(*) on 2.39M rows
    let query = client
      .from('watch_records')
      .select('*')
      .eq('verdict', verdict)
      .limit(pageSize);

    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.eq('reference', reference);
    if (search) {
      query = query.or(`brand.ilike.%${search}%,reference.ilike.%${search}%,raw_message.ilike.%${search}%`);
    }

    const { data, error } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    res.status(200).json({
      rows: data || [],
      total: data?.length || 0,
      page: parseInt(page),
      limit: pageSize
    });
  } catch (err) {
    console.error('Listings error:', err);
    res.status(500).json({ error: err.message, demo: true });
  }
};
