/**
 * Phase 5: Live Monitoring Dashboard
 * Shows real-time pipeline health, approval rates, and HKD migration status
 * 
 * GET /api/monitor — Full health check with all subsystems
 */

const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;

  const supabase = getClient();
  const startTime = Date.now();
  const results = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_ms: null,
    subsystems: {}
  };

  // 1. Database connectivity
  try {
    const t0 = Date.now();
    const { count, error } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true });
    results.subsystems.db = {
      ok: !error,
      latency_ms: Date.now() - t0,
      total_records: count,
      error: error?.message || null
    };
  } catch (e) {
    results.status = 'degraded';
    results.subsystems.db = { ok: false, error: e.message };
  }

  // 2. Parser health
  try {
    const t0 = Date.now();
    const { parseFull } = require('./_lib/parser');
    const test = parseFull('Rolex 126500 black dial 2024 $35000');
    results.subsystems.parser = {
      ok: !!(test && test.brand),
      latency_ms: Date.now() - t0,
      test_brand: test?.brand || null,
      test_ref: test?.ref || null
    };
  } catch (e) {
    results.status = 'degraded';
    results.subsystems.parser = { ok: false, error: e.message };
  }

  // 3. HKD migration status
  try {
    const { count: remaining } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .is('price_usd', null)
      .ilike('raw_message', '%HKD%');

    const { count: totalHkd } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .ilike('raw_message', '%HKD%');

    results.subsystems.hkd_migration = {
      ok: remaining < 1000,
      total_hkd_records: totalHkd,
      remaining_to_fix: remaining,
      fixed_pct: totalHkd > 0 ? Math.round((1 - remaining / totalHkd) * 100) : 100
    };
  } catch (e) {
    results.subsystems.hkd_migration = { ok: false, error: e.message };
  }

  // 4. Verdict distribution (last hour)
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: verdicts, error } = await supabase
      .from('watch_records')
      .select('verdict, confidence')
      .gte('created_at', oneHourAgo)
      .limit(5000);

    if (!error && verdicts) {
      const dist = { APPROVED: 0, REVIEW: 0, HUMAN: 0 };
      let total = 0;
      for (const r of verdicts) {
        if (r.verdict && dist[r.verdict] !== undefined) dist[r.verdict]++;
        total++;
      }
      results.subsystems.recent_routing = {
        ok: true,
        last_hour_count: total,
        distribution: dist,
        auto_approve_rate: total > 0 ? Math.round((dist.APPROVED / total) * 100) : 0
      };
    }
  } catch (e) {
    // Non-critical
  }

  // 5. Green API webhook health (last 10 minutes)
  try {
    const tenMinAgo = new Date(Date.now() - 600000).toISOString();
    const { count: recentWebhooks } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'green_api_live')
      .gte('created_at', tenMinAgo);

    results.subsystems.green_api = {
      ok: true,
      recent_msgs: recentWebhooks
    };
  } catch (e) {
    results.subsystems.green_api = { ok: false, error: e.message };
  }

  // 6. Materialized views freshness
  try {
    const { data: stats, error } = await supabase
      .from('mv_stats_summary')
      .select('*')
      .single();

    results.subsystems.materialized_views = {
      ok: !error,
      total_approved: stats?.approved_count || 0,
      total_records_from_views: stats?.total_count || 0
    };
  } catch (e) {
    results.subsystems.materialized_views = { ok: false, error: e.message };
  }

  results.uptime_ms = Date.now() - startTime;

  return res.status(results.status === 'ok' ? 200 : 207).json(results);
};
