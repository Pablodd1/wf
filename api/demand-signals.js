/**
 * Demand Signals API — aggregates buyer/seller intent from live_ingest table.
 * Uses actual column names from the Supabase schema.
 * live_ingest columns: raw_message, brand, reference, dial_color, condition,
 *   year, price_raw, price_usd, currency, confidence, verdict, source,
 *   channel_id, image_url, llm_used, message_hash, received_at
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
    // Query live_ingest using actual columns that exist
    const url = `${SUPABASE_URL}/rest/v1/live_ingest?select=reference,brand,verdict,confidence,source&limit=5000&order=received_at.desc`;
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
      return res.status(502).json({ error: 'Failed to fetch from database', detail: err.substring(0, 200) });
    }

    const records = await r.json();

    // Aggregate by reference
    const byRef = {};
    for (const rec of records) {
      const ref = rec.reference || 'UNKNOWN';
      if (!byRef[ref]) {
        byRef[ref] = {
          reference: ref,
          collection: rec.brand || 'Unknown',
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

      // Derive buyer/seller intent from source and verdict
      // Messages from 'green-api' or channel sources are real market data
      const source = (rec.source || '').toLowerCase();
      const verdict = (rec.verdict || '').toUpperCase();
      
      // Heuristic: APPROVED = sell listing, HUMAN/review = WTB/NTQ, RECYCLE = unclear
      if (verdict === 'RECYCLE') {
        byRef[ref].unclear++;
      } else if (source.includes('wtb') || source.includes('buy')) {
        byRef[ref].buyers++;
      } else {
        // Default: treat non-recycle records as sellers (most common in dealer chat)
        byRef[ref].sellers++;
      }
    }

    // Compute ratios and scores
    const results = Object.values(byRef).map((ref) => {
      const total = ref.total_mentions;
      ref.buyer_ratio = total > 0 ? ref.buyers / total : 0;
      ref.seller_ratio = total > 0 ? ref.sellers / total : 0;
      ref.buyer_seller_ratio = ref.sellers > 0 ? ref.buyers / ref.sellers : ref.buyers;
      // Liquidity score: 0-100 based on volume + balance
      const volumeScore = Math.min(100, ref.total_mentions * 2);
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
