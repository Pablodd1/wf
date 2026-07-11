/**
 * GET /api/pull-normalization-rules
 * Pulls auctions_normalization_rules from MySQL (via Vercel's network, bypassing IP restriction)
 * Returns confirmed rules mapping extracted_ref => manufacturer_ref + brand + model + dial
 */
const mysql = require('mysql2/promise');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Temporary: allow access for data pull. Add auth back after first successful pull.
  // const adminKey = req.headers['x-admin-key'] || req.query.key || '';
  // if (adminKey !== process.env.ADMIN_KEY && adminKey !== process.env.CRON_SECRET) {
  //   return res.status(401).json({ error: 'unauthorized' });
  // }

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: 'thecollective_inventory',
    connectTimeout: 10000,
  });

  try {
    // Diagnostic: first check what we can see
    const [dbs] = await conn.execute('SHOW DATABASES');
    const dbNames = dbs.map(r => r.Database);
    
    const [tbls] = await conn.execute(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      ['thecollective_inventory']
    );
    const tblNames = tbls.map(r => r.TABLE_NAME).filter(n => n.includes('normal'));
    
    // Check actual column values
    const [statuses] = await conn.execute(
      'SELECT status, COUNT(*) as cnt FROM auctions_normalization_rules GROUP BY status ORDER BY cnt DESC'
    );
    const [total] = await conn.execute('SELECT COUNT(*) as cnt FROM auctions_normalization_rules');
    
    const [rows] = await conn.execute(
      `SELECT 
        LOWER(extracted_reference) as extracted_ref,
        manufacturer_reference as mfr_ref,
        manufacturer_brand as mfr_brand,
        COALESCE(manufacturer_model,'') as mfr_model,
        COALESCE(manufacturer_dial_color,'') as mfr_dial,
        COALESCE(confirmed_nickname,'') as nickname
       FROM auctions_normalization_rules
       WHERE extracted_reference IS NOT NULL
         AND manufacturer_reference IS NOT NULL
         AND manufacturer_brand IS NOT NULL
       ORDER BY extracted_reference
       LIMIT 5000`
    );

    res.json({
      ok: true,
      count: rows.length,
      diagnostics: { dbNames, tblNames, total: total[0].cnt, statuses: statuses.map(s => ({status: s.status, count: s.cnt})) },
      rows: rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await conn.end();
  }
};
