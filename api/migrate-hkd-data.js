/**
 * HKD Data Correction Migration
 * Fixes historical records where HKD was divided by 7.8 instead of multiplied by 0.128
 * 
 * Run: curl -X POST "https://watchfacts-poc.vercel.app/api/migrate-hkd-data"
 * (requires ADMIN_KEY in request body)
 */
const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin auth check
  const { adminKey, dryRun = true, debug = false } = req.body;
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  try {
    const supabase = getClient();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client unavailable' });
    }

    // Debug mode: show what's actually in the database
    if (debug) {
      // Check NULL vs empty string vs actual currency values
      const { count: nullCount } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .is('currency', null);

      const { count: emptyCount } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .eq('currency', '');

      const { data: distinctCurrencies } = await supabase
        .from('watch_records')
        .select('currency')
        .not('currency', 'is', null)
        .not('currency', 'eq', '')
        .limit(50);

      const uniqueCurrencies = [...new Set((distinctCurrencies || []).map(r => r.currency))];

      // Sample HKD records
      const { data: hkdSample } = await supabase
        .from('watch_records')
        .select('id, raw_message, currency, price_usd')
        .ilike('raw_message', '%HKD%')
        .limit(5);

      return res.json({
        debug: true,
        nullCurrencyCount: nullCount,
        emptyStringCurrencyCount: emptyCount,
        distinctCurrencyValues: uniqueCurrencies,
        hkdSampleRecords: hkdSample || [],
      });
    }

    // Find HKD records — currency can be NULL or empty string or missing
    // The key identifier is HKD in raw_message
    const { data: rows, error } = await supabase
      .from('watch_records')
      .select('id, price_usd, raw_message, currency')
      .ilike('raw_message', '%HKD%')
      .gt('price_usd', 0);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.json({
        dryRun,
        totalAffected: 0,
        sample: [],
        message: 'No HKD records found in database.'
      });
    }

    const affected = [];
    for (const row of rows) {
      const msg = row.raw_message;
      if (!msg) continue;

      // Extract the HKD amount from raw_message
      const hkdMatch = msg.match(/(\d[\d,]*\.?\d*)\s*(?:k|m)?\s*hkd|hkd\s*(\d[\d,]*\.?\d*)\s*(?:k|m)?/i)
        || msg.match(/(\d{4,7})\s*hkd|hkd\s*(\d{4,7})/i);

      if (!hkdMatch) continue;

      const rawHKD = (hkdMatch[1] || hkdMatch[2]).replace(/,/g, '');
      let hkdAmount = parseFloat(rawHKD);

      // Check if k/m suffix was present
      if (/\d[kK]\s*hkd|hkd\s*\d[kK]/i.test(msg)) hkdAmount *= 1000;
      else if (/\d[mM]\s*hkd|hkd\s*\d[mM]/i.test(msg)) hkdAmount *= 1000000;

      if (hkdAmount < 1000) continue; // Skip garbage

      // Expected USD: HKD * 0.128
      const expectedUSD = Math.round(hkdAmount * 0.128);
      const storedPrice = row.price_usd;

      // Only correct if stored price is way off (more than 50% from expected)
      // This catches the ÷7.8 error where stored ≈ expected/61
      const ratio = storedPrice / expectedUSD;
      if (ratio > 0.5 && ratio < 1.5) continue; // Already correct

      const correctedPrice = expectedUSD;

      affected.push({
        id: row.id,
        oldPrice: storedPrice,
        newPrice: correctedPrice,
        hkdAmount: Math.round(hkdAmount),
        expectedUSD,
        storedRatio: ratio.toFixed(3),
        message: msg.substring(0, 80)
      });

      if (!dryRun) {
        await supabase
          .from('watch_records')
          .update({
            price_usd: correctedPrice,
            currency: 'HKD'
          })
          .eq('id', row.id);
      }
    }

    return res.json({
      dryRun,
      totalAffected: affected.length,
      totalScanned: rows.length,
      sample: affected.slice(0, 10),
      message: dryRun
        ? `Dry run complete. ${affected.length} records need correction out of ${rows.length} HKD records.`
        : `Migration complete. ${affected.length} records corrected.`
    });

  } catch (err) {
    console.error('HKD migration error:', err);
    return res.status(500).json({ error: err.message });
  }
};
