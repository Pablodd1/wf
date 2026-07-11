/**
 * GET /api/pull-normalization-rules?page=0&size=10000
 * Pulls auctions_normalization_rules from MySQL via Vercel network.
 * No auth (temporary) — re-add after data pull complete.
 */
const mysql = require('mysql2/promise');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const page = parseInt(req.query.page) || 0;
  const size = Math.min(parseInt(req.query.size) || 10000, 20000);
  const offset = page * size;

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: 'thecollective_inventory',
    connectTimeout: 10000,
  });

  try {
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
       LIMIT ${size} OFFSET ${offset}`
    );

    res.json({ ok: true, count: rows.length, page, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await conn.end();
  }
};
