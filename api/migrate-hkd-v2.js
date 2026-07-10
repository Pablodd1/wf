/**
 * HKD Data Correction — Batch Migration Endpoint
 * Fixes historical records where HKD was divided by 7.84 instead of multiplied by 0.128
 * 
 * Runs in batches of 500, safe for Vercel serverless timeouts
 * Call repeatedly until done (check nextOffset in response)
 * 
 * POST /api/migrate-hkd-v2
 * Body: { adminKey, offset: 0, batchSize: 500, dryRun: true }
 */

const { getClient } = require('./_lib/supabase');

const CORRECTION_FACTOR = 7.84;
const DEFAULT_BATCH = 500;
const VERCEL_TIMEOUT_S = 50; // Leave 10s buffer

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { adminKey, offset = 0, batchSize = DEFAULT_BATCH, dryRun = true } = req.body || {};
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  const startTime = Date.now();
  const supabase = getClient();
  if (!supabase) return res.status(500).json({ error: 'DB client unavailable' });

  try {
    // Only correct records where stored price is clearly wrong (ratio ~0.0163)
    // Safe check: skip records already in correct range
    let currentOffset = offset;
    let totalCorrected = 0;
    let totalScanned = 0;
    let totalSkipped = 0;
    const samples = [];

    while (true) {
      if (Date.now() - startTime > VERCEL_TIMEOUT_S * 1000) {
        return res.json({
          dryRun, totalCorrected, totalScanned, totalSkipped, samples,
          nextOffset: currentOffset,
          message: `Timeout after ${VERCEL_TIMEOUT_S}s. Continue with offset=${currentOffset}`
        });
      }

      const { data: batch, error } = await supabase
        .from('watch_records')
        .select('id, raw_message, price_usd, currency')
        .ilike('raw_message', '%HKD%')
        .gt('price_usd', 0)
        .order('id')
        .range(currentOffset, currentOffset + batchSize - 1);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      for (const row of batch) {
        totalScanned++;
        const msg = (row.raw_message || '').toLowerCase();

        // Skip if no HKD signal
        if (!msg.includes('hkd') && !msg.includes('hk$')) {
          totalSkipped++;
          continue;
        }

        // Extract HKD amount for verification
        let hkdAmount = null;
        const hkdMatch = msg.match(/(\d[\d,]*)\s*hkd|hkd\s*(\d[\d,]*)/i);
        if (hkdMatch) {
          const raw = (hkdMatch[1] || hkdMatch[2]).replace(/,/g, '');
          hkdAmount = parseInt(raw);
          
          // Also check k/m suffix
          if (/\d[kK]\s*hkd|hkd\s*\d[kK]/i.test(msg)) hkdAmount *= 1000;
          else if (/\d[mM]\s*hkd|hkd\s*\d[mM]/i.test(msg)) hkdAmount *= 1000000;
        }

        // Safety: only correct if stored price matches old wrong rate (~0.0163)
        const expectedWrong = hkdAmount ? hkdAmount * 0.0163 : 0;
        const ratio = expectedWrong > 0 ? row.price_usd / expectedWrong : 0;

        if (ratio > 0.7 && ratio < 1.3 && hkdAmount > 1000) {
          // This record has the wrong rate — correct it
          const corrected = Math.round(row.price_usd * CORRECTION_FACTOR);

          if (samples.length < 10) {
            samples.push({
              id: row.id,
              oldPrice: row.price_usd,
              newPrice: corrected,
              hkdAmount,
              msg: row.raw_message?.substring(0, 60)
            });
          }

          if (!dryRun) {
            await supabase
              .from('watch_records')
              .update({ price_usd: corrected, currency: 'HKD' })
              .eq('id', row.id);
          }

          totalCorrected++;
        } else {
          totalSkipped++;
        }
      }

      currentOffset += batchSize;
      if (batch.length < batchSize) break;
    }

    return res.json({
      dryRun,
      totalCorrected,
      totalScanned,
      totalSkipped,
      samples,
      nextOffset: null, // null = done
      message: dryRun
        ? `${totalCorrected} records need correction out of ${totalScanned} scanned`
        : `${totalCorrected} records corrected`
    });

  } catch (err) {
    console.error('HKD migration error:', err);
    return res.status(500).json({ error: err.message });
  }
};
