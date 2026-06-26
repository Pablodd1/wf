/**
 * PIPELINE HEALTH MONITOR — /api/pipeline-health
 *
 * Returns real-time stats about the ingestion pipeline.
 * GET /api/pipeline-health
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };

  async function sbFetch(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('timeout');
      throw e;
    }
  }

  try {
    // ── LIVE INGEST (small table, ~4K records) ──
    const countResp = await sbFetch(
      `${SUPABASE_URL}/rest/v1/live_ingest?select=id&limit=0`,
      { headers: { ...headers, 'Prefer': 'count=estimated' } }
    );
    const countRange = countResp.headers.get('content-range') || '*/0';
    const totalLive = parseInt(countRange.split('/')[1] || '0');

    // ── WATCH RECORDS (main catalog, ~2.4M records — estimated count only) ──
    const histResp = await sbFetch(
      `${SUPABASE_URL}/rest/v1/watch_records?select=id&limit=0`,
      { headers: { ...headers, 'Prefer': 'count=estimated' } }
    );
    const histRange = histResp.headers.get('content-range') || '*/0';
    const totalHistorical = parseInt(histRange.split('/')[1] || '0');

    // ── Verdict breakdown from watch_records (estimated) ──
    const verdictCounts = {};
    for (const v of ['APPROVED', 'HUMAN', 'RECYCLE', 'REVIEW']) {
      try {
        const vr = await sbFetch(
          `${SUPABASE_URL}/rest/v1/watch_records?select=id&verdict=eq.${v}&limit=0`,
          { headers: { ...headers, 'Prefer': 'count=estimated' } }
        );
        const vcr = vr.headers.get('content-range') || '*/0';
        verdictCounts[v] = parseInt(vcr.split('/')[1] || '0');
      } catch { verdictCounts[v] = 0; }
    }

    // ── Recent records (last 100 from live_ingest for breakdowns) ──
    const recentResp = await sbFetch(
      `${SUPABASE_URL}/rest/v1/live_ingest?order=received_at.desc&limit=100&select=source,channel_id,brand,verdict,confidence,received_at`
    );
    const recent = recentResp.ok ? await recentResp.json() : [];

    const bySource = {};
    const byGroup = {};
    const byBrand = {};
    const byVerdict = {};
    let lastMessageAt = null;

    for (const r of recent) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      byGroup[r.channel_id] = (byGroup[r.channel_id] || 0) + 1;
      byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
      byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
      if (!lastMessageAt || r.received_at > lastMessageAt) {
        lastMessageAt = r.received_at;
      }
    }

    const topGroups = Object.entries(byGroup)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, count]) => ({ group: id, messages: count }));

    const now = Date.now();
    const lastMsg = lastMessageAt ? new Date(lastMessageAt).getTime() : 0;
    const secondsSinceLastMessage = lastMsg > 0 ? Math.round((now - lastMsg) / 1000) : null;

    return res.status(200).json({
      status: secondsSinceLastMessage !== null && secondsSinceLastMessage < 86400 ? 'active' : 'stale',
      timestamp: new Date().toISOString(),
      totals: {
        liveRecords: totalLive,
        historicalRecords: totalHistorical,
        combined: totalLive + totalHistorical,
        watchRecords: totalHistorical,
      },
      recentActivity: {
        lastMessageAt: lastMessageAt,
        secondsSinceLastMessage,
        messagesInLast100: recent.length,
      },
      verdicts: verdictCounts,
      breakdowns: { bySource, byGroup, byBrand, byVerdict },
      topGroups,
    });

  } catch (err) {
    console.error('[pipeline-health] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
