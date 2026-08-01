/**
 * GET /api/dealer-stats?raw_message=...&source=...
 * Returns per-dealer WTS/WTB listing counts for the flash-sale detail page.
 *
 * Dealer identity is derived the same way the UI does: extract the trailing
 * signature name from raw_message ("... - Dealer Name"), falling back to the
 * source column. We then count rows whose raw_message ends with the same
 * signature (ilike) split by listing_type.
 *
 * Response: { success, dealer, wts, wtb, total }
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

function extractDealerName(raw, source) {
  if (!raw) return null;
  const m = raw.match(/[-–—]\s*([A-Z][a-zA-Z\s]{2,25})(?:\s*$|\s*\n)/);
  return m ? m[1].trim() : null;
}

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { raw_message, source } = req.query;
  const dealer = extractDealerName(raw_message || '', source || '');

  if (!dealer) {
    // No signature — can't attribute to a dealer; return zeros so UI hides counts
    return res.status(200).json({ success: true, dealer: null, wts: 0, wtb: 0, total: 0 });
  }

  try {
    const client = getClient();
    // Match rows whose raw_message ends with the same " - Dealer" signature.
    // ilike on the tail keeps it selective enough with the trigram index.
    const pattern = `%- ${dealer}%`;

    const [wtsRes, wtbRes] = await Promise.all([
      client.from('watch_records')
        .select('id', { count: 'estimated', head: true })
        .ilike('raw_message', pattern)
        .not('listing_type', 'eq', 'WTB')
        .not('verdict', 'eq', 'RECYCLE'),
      client.from('watch_records')
        .select('id', { count: 'estimated', head: true })
        .ilike('raw_message', pattern)
        .eq('listing_type', 'WTB'),
    ]);

    if (wtsRes.error) throw wtsRes.error;
    if (wtbRes.error) throw wtbRes.error;

    const wts = wtsRes.count || 0;
    const wtb = wtbRes.count || 0;
    res.status(200).json({ success: true, dealer, wts, wtb, total: wts + wtb });
  } catch (err) {
    console.error('dealer-stats error:', err);
    res.status(500).json({ success: false, error: err.message, dealer, wts: 0, wtb: 0, total: 0 });
  }
};
