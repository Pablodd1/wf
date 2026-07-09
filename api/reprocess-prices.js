/**
 * /api/reprocess-prices — Re-process price_usd for a specific brand+reference
 * 
 * Runs raw_message through the current parser (v4.6) and updates price_usd + currency
 * for ALL matching records. Fixes old-parser artifacts like:
 *   - "1908" model number extracted as $1,908 price
 *   - HKD amounts stored without conversion
 *   - "$42k" shorthand not parsed
 * 
 * POST: { admin_key, brand, reference }
 * GET:  ?key=wf-admin-2026&brand=Rolex&reference=52506
 */
const { getClient } = require('./_lib/supabase');
const { parseFull } = require('./_lib/parser');

const CURRENCY_RATES = {
  HKD: 0.128, EUR: 1.08, GBP: 1.27, CHF: 1.13,
  AED: 0.272, SGD: 0.74, JPY: 0.0066, CNY: 0.138,
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin_key = req.method === 'POST' ? req.body?.admin_key : req.query?.key;
  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  const brand = req.body?.brand || req.query?.brand;
  const reference = req.body?.reference || req.query?.reference;
  const limit = Math.min(parseInt(req.body?.limit || req.query?.limit) || 500, 2000);

  if (!brand || !reference) {
    return res.status(400).json({ error: 'brand and reference required' });
  }

  try {
    const client = getClient();

    // 1. Fetch all records for this brand+reference
    const { data: records, error: fetchErr } = await client
      .from('watch_records')
      .select('id, raw_message, price_usd, currency')
      .eq('brand', brand)
      .eq('reference', reference)
      .not('raw_message', 'is', null)
      .order('id', { ascending: true })
      .limit(limit);

    if (fetchErr) throw fetchErr;
    if (!records || records.length === 0) {
      return res.status(200).json({ success: true, total: 0, message: 'No records found' });
    }

    // 2. Re-parse each record
    let updated = 0;
    let unchanged = 0;
    let skippedMultiWatch = 0;
    let skippedAmbiguous = 0;
    let samples = [];

    for (const record of records) {
      const parsed = parseFull(record.raw_message);

      // Skip multi-watch broadcasts — per CTO rule, these are HUMAN review only,
      // never trust an auto-extracted price from a stock list. Force verdict=HUMAN.
      if (parsed.verdict === 'MULTI_WATCH_STOCK_LIST') {
        skippedMultiWatch++;
        await client.from('watch_records').update({ verdict: 'HUMAN', confidence: 50 }).eq('id', record.id);
        continue;
      }

      // Skip ambiguous-currency prices (bare "355k" with no $/HKD/USD marker) —
      // could be off by 7.8x if we guess wrong. Force verdict=HUMAN for confirmation.
      if (parsed.verdict === 'NEEDS_MANUAL_REVIEW' && parsed.reviewReason?.includes('currency marker')) {
        skippedAmbiguous++;
        await client.from('watch_records').update({ verdict: 'HUMAN', confidence: 40 }).eq('id', record.id);
        continue;
      }

      // parseFull() now returns fully-converted USD prices (currency conversion
      // is applied inline inside parsePrice() as of the v4.7 patch) — no need
      // for a second conversion pass here.
      const newPrice = parsed.price;
      const newCurrency = 'USD'; // parsePrice() always converts to USD internally now

      // Only update if price changed significantly (>$10 diff or was null)
      const oldPrice = record.price_usd;
      if (newPrice && (!oldPrice || Math.abs(newPrice - oldPrice) > 10)) {
        const { error: updateErr } = await client
          .from('watch_records')
          .update({ 
            price_usd: newPrice, 
            currency: newCurrency,
            parser_version: 'v4.7-reprocess',
          })
          .eq('id', record.id);

        if (!updateErr) {
          updated++;
          if (samples.length < 5) {
            samples.push({
              id: record.id.substring(0, 8),
              old_price: oldPrice,
              new_price: newPrice,
              raw_snippet: record.raw_message.substring(0, 60),
            });
          }
        }
      } else {
        unchanged++;
      }
    }

    res.status(200).json({
      success: true,
      total: records.length,
      updated,
      unchanged,
      skippedMultiWatch,
      skippedAmbiguous,
      samples,
      message: `Updated ${updated} of ${records.length} prices for ${brand} ${reference}. Skipped ${skippedMultiWatch} multi-watch + ${skippedAmbiguous} ambiguous-currency (need HUMAN review).`
    });

  } catch (err) {
    console.error('reprocess-prices error:', err);
    res.status(500).json({ error: err.message });
  }
};
