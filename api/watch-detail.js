/**
 * GET /api/watch-detail?id=<record_id>
 * Returns per-watch breakdown with confidence protocol field-level analysis.
 *
 * Response shape:
 * {
 *   id, ingested_at, raw_message, source,
 *   classification: { type, language, format },
 *   confidence: { score, action, gap_count, gaps, catalogMatched },
 *   fields: { brand, reference, dial, price, condition, year — each { matched, value, source } },
 *   verdict: { state, reason }
 * }
 */
const { getClient } = require('./_lib/supabase');
const { confidenceTier } = require('./_lib/parser');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  try {
    const { data, error } = await getClient()
      .from('watch_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Record not found' });

    // Build field-level breakdown using the 4-tier confidence protocol
    const extracted = {
      brand: data.brand,
      ref: data.reference,
      dial: data.dial,
      price: data.price_usd || data.price,
      currency: data.currency || 'USD',
      condition: data.condition,
      year: data.year,
    };

    const tier = confidenceTier(extracted, null, []);

    // Determine verdict state
    let verdictState = 'APPROVED';
    let verdictReason = 'All fields matched';
    if (!extracted.brand || !extracted.ref) {
      verdictState = 'RECYCLE';
      verdictReason = 'Missing brand or reference';
    } else if (!extracted.price) {
      verdictState = 'HUMAN';
      verdictReason = 'Missing price — needs human input';
    } else if (tier.score < 85) {
      verdictState = 'REVIEW';
      verdictReason = `${tier.gapCount} gaps detected — needs review`;
    }

    res.status(200).json({
      id: data.id,
      ingested_at: data.received_at || data.created_at,
      raw_message: data.raw_message,
      source: data.source || 'unknown',
      classification: {
        type: data.listing_type || 'SINGLE',
        language: data.language || 'EN',
        format: data.format || 'WHATSAPP_TEXT',
      },
      confidence: {
        score: tier.score,
        action: tier.action,
        gap_count: tier.gapCount,
        gaps: tier.gaps,
        catalogMatched: tier.catalogMatched,
      },
      fields: tier.fields,
      verdict: {
        state: verdictState,
        reason: verdictReason,
        original_verdict: data.verdict,
      },
      metadata: {
        confidence_raw: data.confidence,
        accessories: data.accessories,
        hash: data.hash,
      },
    });
  } catch (err) {
    console.error('watch-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
