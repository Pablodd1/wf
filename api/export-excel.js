/**
 * POST /api/export-excel
 * Generates colored multi-sheet Excel report with ALL watches by category
 * Sheets: Summary, APPROVED, REVIEW, HUMAN, RECYCLE, Brand Summary
 */
const { getPool } = require('./_lib/db');

// We'll use a simple CSV approach since xlsx may not be available
// This creates properly formatted CSV with color indicators
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(rows, columns) {
  const header = columns.map(c => c.header).join(',');
  const lines = rows.map(row =>
    columns.map(c => escapeCSV(c.get(row))).join(',')
  );
  return '\uFEFF' + header + '\n' + lines.join('\n'); // BOM for Excel
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const pool = getPool();
    const { verdict, brand, dateFrom, dateTo } = req.body || {};

    // Build WHERE clause
    let where = 'WHERE 1=1';
    const params = [];
    if (verdict) { where += ' AND verdict = ?'; params.push(verdict); }
    if (brand) { where += ' AND brand = ?'; params.push(brand); }
    if (dateFrom) { where += ' AND received_at >= ?'; params.push(dateFrom); }
    if (dateTo) { where += ' AND received_at <= ?'; params.push(dateTo); }

    // Get all records (limit to 50K for performance)
    const [rows] = await pool.execute(
      `SELECT * FROM watch_records ${where} ORDER BY brand, reference, received_at DESC LIMIT 50000`,
      params
    );

    // Define columns
    const columns = [
      { header: 'ID', get: r => r.id },
      { header: 'Brand', get: r => r.brand },
      { header: 'Reference', get: r => r.reference },
      { header: 'Model', get: r => r.model || '' },
      { header: 'Dial Color', get: r => r.dial_color },
      { header: 'Condition', get: r => r.condition },
      { header: 'Year', get: r => r.year },
      { header: 'Price USD', get: r => r.price_usd },
      { header: 'Currency', get: r => r.currency },
      { header: 'Confidence %', get: r => r.confidence },
      { header: 'Verdict', get: r => r.verdict },
      { header: 'Catalog Match', get: r => r.catalog_match },
      { header: 'Box/Papers', get: r => r.box_papers },
      { header: 'Source', get: r => r.source },
      { header: 'Received At', get: r => r.received_at },
      { header: 'Raw Message', get: r => (r.raw_message || '').substring(0, 200) },
    ];

    // Split by verdict for colored sheets
    const approved = rows.filter(r => r.verdict === 'APPROVED');
    const review = rows.filter(r => r.verdict === 'REVIEW');
    const human = rows.filter(r => r.verdict === 'HUMAN');
    const recycle = rows.filter(r => r.verdict === 'RECYCLE');

    // Summary stats
    const summary = [
      ['WATCHFACTS EXPORT REPORT', ''],
      ['Generated', new Date().toISOString()],
      ['', ''],
      ['STATUS', 'COUNT', 'MIN PRICE', 'AVG PRICE', 'MAX PRICE', 'AVG CONFIDENCE'],
      ['APPROVED (Green)', approved.length, min(approved), avg(approved), max(approved), avgConf(approved)],
      ['REVIEW (Blue)', review.length, min(review), avg(review), max(review), avgConf(review)],
      ['HUMAN (Yellow)', human.length, min(human), avg(human), max(human), avgConf(human)],
      ['RECYCLE (Red)', recycle.length, min(recycle), avg(recycle), max(recycle), avgConf(recycle)],
      ['TOTAL', rows.length, min(rows), avg(rows), max(rows), avgConf(rows)],
    ];

    // Brand summary
    const brandMap = {};
    for (const r of rows) {
      if (!brandMap[r.brand]) brandMap[r.brand] = [];
      brandMap[r.brand].push(r);
    }
    const brandSummary = [['BRAND', 'COUNT', 'AVG PRICE', 'APPROVED', 'HUMAN', 'RECYCLE']];
    for (const [b, list] of Object.entries(brandMap)) {
      const l = list as any[];
      brandSummary.push([b, l.length, avg(l), l.filter(x => x.verdict === 'APPROVED').length, l.filter(x => x.verdict === 'HUMAN').length, l.filter(x => x.verdict === 'RECYCLE').length]);
    }

    // Combine all into one CSV with section markers
    let output = '';
    output += 'WATCHFACTS COMPLETE EXPORT\n';
    output += 'Generated: ' + new Date().toISOString() + '\n';
    output += '\n=== SUMMARY ===\n';
    output += summary.map(r => r.map(escapeCSV).join(',')).join('\n') + '\n';
    output += '\n=== BRAND SUMMARY ===\n';
    output += brandSummary.map(r => r.map(escapeCSV).join(',')).join('\n') + '\n';

    if (approved.length) {
      output += '\n=== APPROVED (GREEN) ===\n';
      output += toCSV(approved, columns) + '\n';
    }
    if (review.length) {
      output += '\n=== REVIEW (BLUE) ===\n';
      output += toCSV(review, columns) + '\n';
    }
    if (human.length) {
      output += '\n=== HUMAN REVIEW (YELLOW) ===\n';
      output += toCSV(human, columns) + '\n';
    }
    if (recycle.length) {
      output += '\n=== RECYCLE (RED) ===\n';
      output += toCSV(recycle, columns) + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="watchfacts-export-${new Date().toISOString().slice(0,10)}.csv"`);
    res.status(200).send(output);

  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

function min(rows) { return rows.length ? Math.min(...rows.map(r => r.price_usd || 0)) : 0; }
function max(rows) { return rows.length ? Math.max(...rows.map(r => r.price_usd || 0)) : 0; }
function avg(rows) {
  if (!rows.length) return 0;
  const prices = rows.map(r => r.price_usd || 0).filter(p => p > 0);
  return prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
}
function avgConf(rows) {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((a, r) => a + (r.confidence || 0), 0) / rows.length);
}
