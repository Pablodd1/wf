/**
 * MySQL Database Connection — WatchFacts
 * Host: 161.35.0.209:3306
 * Replaces Supabase for primary data access
 */

const mysql = require('mysql2/promise');

// Connection pool — reuse connections efficiently
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '161.35.0.209',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'john',
      password: process.env.MYSQL_PASS || 'U0aeAr1zFt2\\',
      database: process.env.MYSQL_DB || 'watchfacts',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000,
      acquireTimeout: 30000,
      enableKeepAlive: true,
    });
  }
  return pool;
}

// Health check
async function ping() {
  const conn = await getPool().getConnection();
  try {
    await conn.ping();
    return { ok: true, latency: Date.now() };
  } finally {
    conn.release();
  }
}

// Generic query
async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// Get all listings with pagination
async function getListings({ page = 1, limit = 50, brand = null, reference = null, verdict = null, search = null }) {
  let sql = 'SELECT * FROM watch_records WHERE 1=1';
  const params = [];
  
  if (brand) {
    sql += ' AND brand = ?';
    params.push(brand);
  }
  if (reference) {
    sql += ' AND reference LIKE ?';
    params.push(`%${reference}%`);
  }
  if (verdict) {
    sql += ' AND verdict = ?';
    params.push(verdict);
  }
  if (search) {
    sql += ' AND (brand LIKE ? OR reference LIKE ? OR raw_message LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  // Get total count
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const [countResult] = await getPool().execute(countSql, params);
  const total = countResult[0].total;
  
  // Get paginated results
  sql += ' ORDER BY received_at DESC LIMIT ? OFFSET ?';
  params.push(limit, (page - 1) * limit);
  
  const [rows] = await getPool().execute(sql, params);
  
  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// Get dashboard stats — MySQL compatible (no FILTER clause)
async function getStats() {
  const sql = `
    SELECT 
      COUNT(*) as totalRecords,
      COUNT(CASE WHEN verdict = 'APPROVED' THEN 1 END) as approvedCount,
      COUNT(CASE WHEN verdict = 'HUMAN' THEN 1 END) as humanCount,
      COUNT(CASE WHEN verdict = 'RECYCLE' THEN 1 END) as recycleCount,
      COUNT(CASE WHEN verdict = 'REVIEW' THEN 1 END) as reviewCount,
      AVG(price_usd) as avgPrice,
      MIN(price_usd) as minPrice,
      MAX(price_usd) as maxPrice,
      AVG(confidence) as avgConfidence
    FROM watch_records
  `;
  const [rows] = await getPool().execute(sql);
  return rows[0];
}

// Get brand distribution
async function getBrandDistribution() {
  const sql = `
    SELECT brand, COUNT(*) as count, AVG(price_usd) as avgPrice
    FROM watch_records
    WHERE brand IS NOT NULL
    GROUP BY brand
    ORDER BY count DESC
  `;
  const [rows] = await getPool().execute(sql);
  return rows;
}

// Get monthly price data for chart
async function getMonthlyPrices(reference, months = 6) {
  const sql = `
    SELECT 
      DATE_FORMAT(received_at, '%Y-%m') as month,
      MIN(price_usd) as minPrice,
      AVG(price_usd) as avgPrice,
      MAX(price_usd) as maxPrice,
      COUNT(*) as count
    FROM watch_records
    WHERE reference = ? 
      AND price_usd > 0
      AND received_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
    GROUP BY DATE_FORMAT(received_at, '%Y-%m')
    ORDER BY month
  `;
  const [rows] = await getPool().execute(sql, [reference, months]);
  return rows;
}

// Get listings for a specific reference and month
async function getListingsByMonth(reference, month) {
  const sql = `
    SELECT * FROM watch_records
    WHERE reference = ? 
      AND DATE_FORMAT(received_at, '%Y-%m') = ?
      AND price_usd > 0
    ORDER BY price_usd
  `;
  const [rows] = await getPool().execute(sql, [reference, month]);
  return rows;
}

// Update a listing
async function updateListing(id, updates) {
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  
  const sql = `UPDATE watch_records SET ${setClause}, updated_at = NOW() WHERE id = ?`;
  const [result] = await getPool().execute(sql, [...values, id]);
  return result;
}

// Get catalog entry for a reference
async function getCatalogEntry(reference) {
  const sql = 'SELECT * FROM catalog WHERE reference = ? LIMIT 1';
  const [rows] = await getPool().execute(sql, [reference]);
  return rows[0] || null;
}

module.exports = {
  getPool,
  ping,
  query,
  getListings,
  getStats,
  getBrandDistribution,
  getMonthlyPrices,
  getListingsByMonth,
  updateListing,
  getCatalogEntry,
};
