/**
 * HKD Data Correction Migration
 * Fixes historical records where HKD was stored using rate ~0.0163 instead of 0.128
 * (the old parser effectively divided by 61.3 instead of multiplying by 0.128)
 * 
 * Correction factor: 0.128 / 0.0163 ≈ 7.84
 * 
 * Run: POST /api/migrate-hkd-data
 * Body: { adminKey, dryRun: true|false, batchSize: 500 }
 */
const { getClient } = require('./_lib/supabase');

const CORRECTION_FACTOR = 7.84; // 0.128 / 0.0163

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { adminKey, dryRun = true, debug = false, batchSize = 50, offset = 0 } = req.body;
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  try {
    const supabase = getClient();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client unavailable' });
    }

    // Vercel serverless timeout protection (55s max, leave 5s buffer)
    const startTime = Date.now();
    const TIMEOUT_MS = 55000;

    if (debug) {
      // Diagnostic: check currency distribution and sample HKD records
      const { count: totalRecords } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true });

      const { data: hkdSample } = await supabase
        .from('watch_records')
        .select('id, raw_message, currency, price_usd')
        .ilike('raw_message', '%HKD%')
        .gt('price_usd', 0)
        .limit(10);

      // Check how many HKD records exist total
      const { count: hkdTotal } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .ilike('raw_message', '%HKD%');

      return res.json({
        debug: true,
        totalRecords,
        hkdTotal,
        correctionFactor: CORRECTION_FACTOR,
        sampleRecords: hkdSample || [],
      });
    }

    // Strategy: find records with HKD in message where stored price looks
    // like HKD × 0.0163 (the old wrong rate). Correct by multiplying by 7.84.
    //
    // We can't reliably re-parse HKD amounts from messages (years, refs, etc.
    // interfere), so instead we identify the old-rate pattern:
    //   storedPrice / rawHKD ≈ 0.0163
    // If the ratio is close to 0.0163, we apply the correction factor.
    
    let currentOffset = offset; // Use parameter from request body
    let totalScanned = 0;
    let totalCorrected = 0;
    let totalSkipped = 0;
    const samples = [];
    let timedOut = false;

    while (true) {
      // Timeout protection: exit loop if approaching Vercel's 60s limit
      if (Date.now() - startTime > TIMEOUT_MS) {
        timedOut = true;
        break;
      }

      const { data: batch, error } = await supabase
        .from('watch_records')
        .select('id, price_usd, raw_message')
        .ilike('raw_message', '%HKD%')
        .gt('price_usd', 0)
        .order('id')
        .range(currentOffset, currentOffset + batchSize - 1);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      for (const row of batch) {
        totalScanned++;
        const msg = row.raw_message;
        if (!msg) { totalSkipped++; continue; }

        // Try to extract the HKD amount for verification
        // Look for patterns like: 850000, 850,000, 850k, 1.09m adjacent to HKD
        let hkdAmount = null;
        
        const patterns = [
          /(\d[\d,]*\.?\d*)\s*(?:k|m)?\s*hkd/i,
          /hkd\s*(\d[\d,]*\.?\d*)\s*(?:k|m)?/i,
          /hk\$\s*(\d[\d,]*\.?\d*)\s*(?:k|m)?/i,
          /(\d[\d,]*\.?\d*)\s*(?:k|m)?\s*hk\$/i,
        ];

        for (const pat of patterns) {
          const m = msg.match(pat);
          if (m) {
            let num = parseFloat(m[1].replace(/,/g, ''));
            // Check for k/m suffix after the number (within 3 chars)
            const suffix = msg.substring(m.index + m[1].length, m.index + m[1].length + 3).toLowerCase();
            if (suffix.includes('k')) num *= 1000;
            else if (suffix.includes('m')) num *= 1000000;
            if (num >= 10000) { // HKD amounts are typically 10k+
              hkdAmount = num;
              break;
            }
          }
        }

        if (!hkdAmount) {
          totalSkipped++;
          continue;
        }

        // Check if stored price matches the old wrong rate (0.0163)
        const expectedWrongRate = hkdAmount * 0.0163;
        const ratio = row.price_usd / expectedWrongRate;

        // Accept if stored price is within 20% of the wrong-rate value
        if (ratio < 0.8 || ratio > 1.2) {
          // Stored price doesn't match old wrong rate — might already be correct
          totalSkipped++;
          continue;
        }

        // Apply correction
        const correctedPrice = Math.round(row.price_usd * CORRECTION_FACTOR);

        if (samples.length < 15) {
          samples.push({
            id: row.id,
            oldPrice: row.price_usd,
            newPrice: correctedPrice,
            hkdAmount: Math.round(hkdAmount),
            oldRate: (row.price_usd / hkdAmount).toFixed(4),
            message: msg.substring(0, 80)
          });
        }

        if (!dryRun) {
          await supabase
            .from('watch_records')
            .update({
              price_usd: correctedPrice,
              currency: 'HKD'
            })
            .eq('id', row.id);
        }

        totalCorrected++;
      }

      currentOffset += batchSize;
      if (batch.length < batchSize) break;
    }

    return res.json({
      dryRun,
      totalScanned,
      totalCorrected,
      totalSkipped,
      correctionFactor: CORRECTION_FACTOR,
      samples,
      nextOffset: timedOut ? currentOffset : null,
      message: dryRun
        ? `Dry run: ${totalCorrected} records would be corrected out of ${totalScanned} scanned.${timedOut ? ' (timeout - continue with nextOffset)' : ''}`
        : `Migration complete: ${totalCorrected} records corrected.${timedOut ? ' (timeout - continue with nextOffset)' : ''}`
    });

  } catch (err) {
    console.error('HKD migration error:', err);
    return res.status(500).json({ error: err.message });
  }
};
