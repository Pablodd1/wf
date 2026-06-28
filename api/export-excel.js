/**
 * POST /api/export-excel
 * Generates colored multi-sheet CSV report with ALL watches by category — SUPABASE
 */
const { getClient } = require('./_lib/supabase');

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function toCSV(rows, columns) {
  if (!rows?.length) return '';
  const header = columns.map(c => c.header).join(',');
  const lines = rows.map(row => columns.map(c => escapeCSV(c.get(row))).join(','));
  return '\uFEFF' + header + '\n' + lines.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { verdict, brand, dateFrom, dateTo } = req.body || {};
    const supabase = getClient();

    // Build query
    let q = supabase.from('watch_records').select('*');
    if (verdict) q = q.eq('verdict', verdict);
    if (brand) q = q.eq('brand', brand);
    if (dateFrom) q = q.gte('received_at', dateFrom);
    if (dateTo) q = q.lte('received_at', dateTo);

    const { data: rows, error } = await q.order('brand').order('reference');
    if (error) throw error;

    const records = rows || [];
    const columns = [
      { header: 'ID', get: r => r.id },
      { header: 'Brand', get: r => r.brand },
      { header: 'Reference', get: r => r.reference },
      { header: 'Dial Color', get: r => r.dial_color },
      { header: 'Condition', get: r => r.condition },
      { header: 'Year', get: r => r.year },
      { header: 'Price USD', get: r => r.price_usd },
      { header: 'Confidence', get: r => r.confidence },
      { header: 'Verdict', get: r => r.verdict },
      { header: 'Catalog Match', get: r => r.catalog_match },
      { header: 'Received', get: r => r.received_at },
      { header: 'Raw Message', get: r => (r.raw_message || '').substring(0, 200) },
    ];

    const approved = records.filter(r => r.verdict === 'APPROVED');
    const review = records.filter(r => r.verdict === 'REVIEW');
    const human = records.filter(r => r.verdict === 'HUMAN');
    const recycle = records.filter(r => r.verdict === 'RECYCLE');

    let output = '';
    output += 'WATCHFACTS EXPORT REPORT\n';
    output += 'Generated: ' + new Date().toISOString() + '\n';
    output += 'Total Records: ' + records.length + '\n\n';

    // Summary
    output += '=== SUMMARY ===\n';
    output += 'STATUS,COUNT,MIN_PRICE,AVG_PRICE,MAX_PRICE\n';
    for (const [label, data] of [['APPROVED',approved],['REVIEW',review],['HUMAN',human],['RECYCLE',recycle],['TOTAL',records]]) {
      const prices = data.map(r => r.price_usd).filter(p => p > 0);
      output += `${label},${data.length},${prices.length?Math.min(...prices):0},${prices.length?Math.round(prices.reduce((a,b)=>a+b,0)/prices.length):0},${prices.length?Math.max(...prices):0}\n`;
    }

    if (approved.length) { output += '\n=== APPROVED (GREEN) ===\n'; output += toCSV(approved, columns) + '\n'; }
    if (review.length) { output += '\n=== REVIEW (BLUE) ===\n'; output += toCSV(review, columns) + '\n'; }
    if (human.length) { output += '\n=== HUMAN REVIEW (YELLOW) ===\n'; output += toCSV(human, columns) + '\n'; }
    if (recycle.length) { output += '\n=== RECYCLE (RED) ===\n'; output += toCSV(recycle, columns) + '\n'; }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="watchfacts-export-${new Date().toISOString().slice(0,10)}.csv"`);
    res.status(200).send(output);

  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
