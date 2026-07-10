/**
 * HKD Data Correction Migration
 * Fixes historical records where HKD was divided by 7.8 instead of multiplied by 0.128
 * 
 * Run: curl -X POST "https://watchfacts-poc.vercel.app/api/migrate-hkd-data"
 * (requires ADMIN_KEY in request body)
 */
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin auth check
  const { adminKey, dryRun = true } = req.body;
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Find all HKD records with no currency flag
    const { data: rows, error } = await supabase
      .from('watch_records')
      .select('id, price_usd, raw_message, currency')
      .is('currency', null)
      .ilike('raw_message', '%HKD%')
      .gt('price_usd', 0);

    if (error) throw error;

    const affected = [];
    for (const row of rows) {
      // Verify it's actually HKD (not just mentioning HKD elsewhere)
      const msg = row.raw_message.toUpperCase();
      if (!msg.includes('HKD')) continue;

      // Correct the price: old logic did HKD / 7.8, so we multiply back by 7.8
      const correctedPrice = Math.round(row.price_usd * 7.8);
      
      affected.push({
        id: row.id,
        oldPrice: row.price_usd,
        newPrice: correctedPrice,
        correction: '+7.8x',
        message: row.raw_message.substring(0, 60)
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
      sample: affected.slice(0, 10),
      message: dryRun 
        ? 'Dry run complete. Set dryRun=false to apply changes.'
        : 'Migration complete.'
    });

  } catch (err) {
    console.error('HKD migration error:', err);
    return res.status(500).json({ error: err.message });
  }
};
