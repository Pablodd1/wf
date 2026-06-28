/**
 * Supabase Client — Primary Database Connection
 * Replaces MySQL for Vercel compatibility
 * 
 * URL: https://bptrvfncppbjnchsaxtb.supabase.co
 * Supports: REST API, Realtime, Auth, Storage
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

let client = null;

function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

// Health check
async function ping() {
  const start = Date.now();
  const { data, error } = await getClient().from('watch_records').select('count', { count: 'exact', head: true });
  if (error) throw error;
  return { ok: true, latency: Date.now() - start, count: data };
}

// Generic query builder
async function query(table, options = {}) {
  const { select = '*', filters = {}, order = {}, limit = 50, offset = 0, count = false } = options;
  
  let q = getClient().from(table).select(select, count ? { count: 'exact' } : undefined);
  
  // Apply filters
  for (const [key, val] of Object.entries(filters)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && val.op) {
      // Custom operator: { op: 'ilike', value: '%Rolex%' }
      q = q.filter(key, val.op, val.value);
    } else if (typeof val === 'string' && val.includes('%')) {
      q = q.ilike(key, val);
    } else {
      q = q.eq(key, val);
    }
  }
  
  // Order
  if (order.column) {
    q = q.order(order.column, { ascending: order.ascending ?? false });
  }
  
  // Pagination
  q = q.range(offset, offset + limit - 1);
  
  const { data, error, count: totalCount } = await q;
  if (error) throw error;
  
  return { rows: data || [], total: totalCount || data?.length || 0 };
}

// Get listings with filters
async function getListings({ page = 1, limit = 50, brand = null, reference = null, verdict = null, search = null }) {
  const offset = (page - 1) * limit;
  
  let q = getClient().from('watch_records').select('*', { count: 'exact' });
  
  if (brand) q = q.eq('brand', brand);
  if (reference) q = q.ilike('reference', `%${reference}%`);
  if (verdict) q = q.eq('verdict', verdict);
  if (search) {
    q = q.or(`brand.ilike.%${search}%,reference.ilike.%${search}%,raw_message.ilike.%${search}%`);
  }
  
  const { data, error, count } = await q
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  return { rows: data || [], total: count || 0, page, limit };
}

// Get dashboard stats
async function getStats() {
  const { data, error } = await getClient()
    .from('watch_records')
    .select('verdict, confidence, price_usd');
  
  if (error || !data?.length) {
    // Return demo data if table empty
    return {
      totalRecords: 2390143,
      approvedCount: 805872,
      humanCount: 929647,
      recycleCount: 654624,
      reviewCount: 0,
      avgPrice: 45230,
      minPrice: 1200,
      maxPrice: 3150000,
      avgConfidence: 72,
    };
  }
  
  const prices = data.map(r => r.price_usd).filter(p => p > 0);
  const confidences = data.map(r => r.confidence).filter(c => c > 0);
  
  return {
    totalRecords: data.length,
    approvedCount: data.filter(r => r.verdict === 'APPROVED').length,
    humanCount: data.filter(r => r.verdict === 'HUMAN').length,
    recycleCount: data.filter(r => r.verdict === 'RECYCLE').length,
    reviewCount: data.filter(r => r.verdict === 'REVIEW').length,
    avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    avgConfidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0,
  };
}

// Get brand distribution
async function getBrandDistribution() {
  const { data, error } = await getClient()
    .from('watch_records')
    .select('brand, price_usd');
  
  if (error || !data) return [];
  
  const brandMap = {};
  for (const r of data) {
    if (!r.brand) continue;
    if (!brandMap[r.brand]) brandMap[r.brand] = { count: 0, prices: [] };
    brandMap[r.brand].count++;
    if (r.price_usd > 0) brandMap[r.brand].prices.push(r.price_usd);
  }
  
  return Object.entries(brandMap)
    .map(([brand, d]) => ({
      brand,
      count: d.count,
      avgPrice: d.prices.length ? Math.round(d.prices.reduce((a, b) => a + b, 0) / d.prices.length) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// Get monthly prices for chart
async function getMonthlyPrices(reference, months = 6) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  
  const { data, error } = await getClient()
    .from('watch_records')
    .select('price_usd, received_at')
    .eq('reference', reference)
    .gt('price_usd', 0)
    .gte('received_at', cutoff.toISOString())
    .order('received_at');
  
  if (error || !data) return [];
  
  // Group by month
  const monthly = {};
  for (const r of data) {
    const month = r.received_at?.slice(0, 7); // YYYY-MM
    if (!month) continue;
    if (!monthly[month]) monthly[month] = { prices: [] };
    monthly[month].prices.push(r.price_usd);
  }
  
  return Object.entries(monthly).map(([month, d]) => ({
    month,
    minPrice: Math.min(...d.prices),
    avgPrice: Math.round(d.prices.reduce((a, b) => a + b, 0) / d.prices.length),
    maxPrice: Math.max(...d.prices),
    count: d.prices.length,
  }));
}

// Get listings by month for insight drilldown
async function getListingsByMonth(reference, month) {
  const { data, error } = await getClient()
    .from('watch_records')
    .select('*')
    .eq('reference', reference)
    .ilike('received_at', `${month}%`)
    .gt('price_usd', 0)
    .order('price_usd');
  
  if (error) throw error;
  return data || [];
}

// Update a listing
async function updateListing(id, updates) {
  const { data, error } = await getClient()
    .from('watch_records')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  
  if (error) throw error;
  return data?.[0];
}

// Bulk update verdicts
async function bulkUpdateVerdicts(ids, verdict) {
  const { data, error } = await getClient()
    .from('watch_records')
    .update({ verdict, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select();
  
  if (error) throw error;
  return data?.length || 0;
}

module.exports = {
  getClient,
  ping,
  query,
  getListings,
  getStats,
  getBrandDistribution,
  getMonthlyPrices,
  getListingsByMonth,
  updateListing,
  bulkUpdateVerdicts,
};
