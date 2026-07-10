const { createClient } = require('@supabase/supabase-js');
const { setCorsHeaders } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  
  const start = Date.now();
  const checks = {};
  
  // Check 1: Supabase connectivity
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      const { data, error } = await supabase.from('watch_records').select('id').limit(1);
      checks.supabase = {
        ok: !error,
        latency: Date.now() - start,
        error: error?.message || null,
      };
    } else {
      checks.supabase = { ok: false, latency: 0, error: 'Missing Supabase credentials' };
    }
  } catch (e) {
    checks.supabase = { ok: false, latency: Date.now() - start, error: e.message };
  }

  // Check 2: Parser service (load and test)
  try {
    const { parseFull } = require('./_lib/parser');
    const result = parseFull('Rolex 126610LN 2024 USD15000');
    checks.parser = {
      ok: result && result.brand === 'Rolex' && result.ref === '126610LN',
      latency: Date.now() - start,
      error: result ? null : 'Parser returned empty',
    };
  } catch (e) {
    checks.parser = { ok: false, latency: Date.now() - start, error: e.message };
  }

  // Check 3: Catalog matcher
  try {
    const { lookupCatalog } = require('./_lib/catalog-matcher');

    const cat = lookupCatalog('Rolex', '126610LN');
    checks.catalog = {
      ok: !!cat,
      latency: Date.now() - start,
      error: cat ? null : 'Catalog not loaded',
    };
  } catch (e) {
    checks.catalog = { ok: false, latency: Date.now() - start, error: e.message };
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks,
    env: {
      supabase_url: process.env.SUPABASE_URL ? 'set' : 'missing',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing',
    }
  });
};
