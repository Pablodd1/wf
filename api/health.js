'use strict';

function supabaseProjectRef(value) {
  try {
    const parsed = new URL(String(value || ''));
    const match = parsed.protocol === 'https:'
      ? parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)
      : null;
    return match?.[1] || null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const databaseProjectRef = supabaseProjectRef(supabaseUrl);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      status: 'degraded',
      database: 'not_configured',
      database_project_ref: databaseProjectRef,
    });
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/watch_records?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`database returned ${response.status}`);
    return res.status(200).json({
      status: 'ok',
      database: 'reachable',
      database_project_ref: databaseProjectRef,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[health] Database probe failed:', error.message);
    return res.status(503).json({
      status: 'degraded',
      database: 'unreachable',
      database_project_ref: databaseProjectRef,
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports.supabaseProjectRef = supabaseProjectRef;
