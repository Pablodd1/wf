/**
 * Demand Signals API — aggregates buyer/seller intent from live_ingest table.
 * Replaces the static enriched_refs.json with live Supabase data.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  try {
    // Fetch recent records with intent classification from live_ingest
    const url = `${SUPABASE_URL}/rest/v1/live_ingest?select=reference,brand,collection,intent,price&limit=5000&order=created_at.desc`;
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[demand-signals] Supabase error:', err);
      return res.status(502).json({ error: 'Failed to fetch from database' });
    }

    const records = await r.json();

    // Aggregate by reference
    const byRef = {};
    for (const rec of records) {
      const ref = rec.reference || 'UNKNOWN';
      if (!byRef[ref]) {
        byRef[ref] = {
          reference: ref,
          collection: rec.collection || rec.brand || 'Unknown',
          model: '',
          case_metal: '',
          production_years: '',
          status: 'active',
          total_mentions: 0,
          buyers: 0,
          sellers: 0,
          unclear: 0,
          buyer_ratio: 0,
          seller_ratio: 0,
          buyer_seller_ratio: 0,
          liquidity_score: 0,
          in_catalog: false,
          has_images: false,
          image_count: 0
        };
      }

      byRef[ref].total_mentions++;

      const intent = (rec.intent || '').toUpperCase();
      if (intent === 'BUY' || intent === 'WTB' || intent === 'NTQ') {
        byRef[ref].buyers++;
      } else if (intent === 'SELL' || intent === 'FS' || intent === 'WTS') {
        byRef[ref].sellers++;
      } else {
        byRef[ref].unclear++;
      }
    }

    // Compute ratios and scores
    const results = Object.values(byRef).map((ref) => {
      const total = ref.total_mentions;
      ref.buyer_ratio = total > 0 ? ref.buyers / total : 0;
      ref.seller_ratio = total > 0 ? ref.sellers / total : 0;
      ref.buyer_seller_ratio = ref.sellers > 0 ? ref.buyers / ref.sellers : ref.buyers;
      // Liquidity score: 0-100 based on volume + balance
      const volumeScore = Math.min(100, ref.total_mentions * 2); // 50 mentions = 100
      const balanceScore = ref.buyer_seller_ratio > 0.3 && ref.buyer_seller_ratio < 3 ? 50 : 20;
      ref.liquidity_score = Math.round((volumeScore + balanceScore) / 2);
      return ref;
    });

    // Sort by liquidity score desc
    results.sort((a, b) => b.liquidity_score - a.liquidity_score || b.total_mentions - a.total_mentions);

    return res.status(200).json(results);
  } catch (err) {
    console.error('[demand-signals] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
