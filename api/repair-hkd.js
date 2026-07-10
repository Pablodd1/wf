/**
 * HKD Repair Endpoint — Re-parses records with NULL prices
 * Uses parser v4.10 which handles HKD correctly
 * 
 * POST /api/repair-hkd
 * Body: { adminKey, batchSize: 1000, offset: 0 }
 */

const { getClient } = require('./_lib/supabase');
const { parseFull, parsePrice, parseCurrency } = require('./_lib/parser');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { adminKey, batchSize = 1000, offset = 0 } = req.body || {};
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  const supabase = getClient();
  if (!supabase) return res.status(500).json({ error: 'DB unavailable' });

  const startTime = Date.now();
  const TIMEOUT_MS = 50000;
  let currentOffset = offset;
  let repaired = 0;
  let failed = 0;

  try {
    while (true) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        return res.json({
          repaired, failed,
          nextOffset: currentOffset,
          message: `Timeout. Continue with offset=${currentOffset}`
        });
      }

      const { data: batch, error } = await supabase
        .from('watch_records')
        .select('id, raw_message')
        .is('price_usd', null)
        .ilike('raw_message', '%HKD%')
        .order('id')
        .range(currentOffset, currentOffset + batchSize - 1);

      if (error) throw error;
      if (!batch || batch.length === 0) {
        return res.json({ repaired, failed, nextOffset: null, message: 'Done' });
      }

      for (const row of batch) {
        try {
          const parsed = parseFull(row.raw_message);
          const price = parsePrice(row.raw_message, parsed.ref);
          const currency = parseCurrency(row.raw_message);

          if (price && price > 100) {
            await supabase
              .from('watch_records')
              .update({ 
                price_usd: price, 
                currency: currency || 'USD'
              })
              .eq('id', row.id);
            repaired++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      currentOffset += batchSize;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, repaired, failed });
  }
};
